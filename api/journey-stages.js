import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { enviarConversao, CONCEPT_KEYS_WPP, CONCEPTS } from './_capi.js';
import { dispararEtapaJornada } from './_journey-trigger.js';

// CRUD da Jornada geral CTWA/WhatsApp (tracking_campaign_id NULL) + histórico.
// Jornadas de links são salvas transacionalmente por /api/tracking-campaigns.
// Multi-tenant: usuário comum só mexe no próprio cliente_id; admin passa
// cliente_id no body/query.

// A jornada inteligente dispara por mensagem (canal WhatsApp/CTWA): só aceita
// conceitos válidos nesse canal. Eventos só-web (Contact, ViewContent...) ficam
// na Jornada de cada link em Captação e Links, não aqui.
const CONCEITOS = CONCEPT_KEYS_WPP;
const CORES_VALIDAS = ['neutral', 'blue', 'amber', 'green', 'red'];

// Valida que um regex compila (evita salvar regex inválida).
function regexValido(str) {
  if (!str) return true;
  try { new RegExp(str); return true; } catch { return false; }
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  await ensureTrackingSchema();
  const pool = getPool();
  const method = req.method;

  const alvoCliente = (val) => {
    if (user.is_admin) return val ? parseInt(val, 10) : user.cliente_id;
    return user.cliente_id;
  };

  try {
    // ── GET ?meta=concepts: lista de conceitos de evento (p/ montar selects) ──
    if (method === 'GET' && req.query.meta === 'concepts') {
      return res.status(200).json(CONCEPTS);
    }

    // ── GET: lista etapas do cliente; ou histórico de um lead (?lead_id=) ──
    if (method === 'GET') {
      const cliente_id = alvoCliente(req.query.cliente_id);
      if (!cliente_id) return res.status(400).json({ error: 'cliente_id é obrigatório para administrador.' });

      if (req.query.action === 'config') {
        const config = await pool.query(
          `SELECT template_venda, template_qualificacao
           FROM clientes
           WHERE id = $1`,
          [cliente_id]
        );
        if (!config.rows.length) return res.status(404).json({ error: 'Cliente não encontrado.' });
        return res.status(200).json(config.rows[0]);
      }

      if (req.query.lead_id) {
        const leadId = parseInt(req.query.lead_id, 10);
        // Garante que o lead é do cliente (isolamento).
        const leadChk = await pool.query(
          'SELECT id FROM leads_tracking WHERE id = $1 AND cliente_id = $2',
          [leadId, cliente_id]
        );
        if (!leadChk.rows.length) return res.status(404).json({ error: 'Lead não encontrado.' });
        const hist = await pool.query(
          `SELECT h.*, s.name AS stage_name
           FROM lead_journey_history h
           LEFT JOIN journey_stages s ON s.id = h.stage_id
           WHERE h.lead_id = $1
           ORDER BY h.created_at ASC`,
          [leadId]
        );
        return res.status(200).json(hist.rows);
      }

      const r = await pool.query(
        `SELECT * FROM journey_stages
         WHERE cliente_id = $1 AND tracking_campaign_id IS NULL
         ORDER BY position ASC, id ASC`,
        [cliente_id]
      );
      const stageIds = r.rows.map(s => s.id);
      let extraEvents = [];
      if (stageIds.length) {
        const ev = await pool.query(
          'SELECT * FROM journey_stage_events WHERE stage_id = ANY($1) ORDER BY id ASC',
          [stageIds]
        );
        extraEvents = ev.rows;
      }
      const stages = r.rows.map(stage => ({
        ...stage,
        extra_events: extraEvents.filter(e => e.stage_id === stage.id),
      }));
      return res.status(200).json(stages);
    }

    // ── POST/PATCH: criar ou editar etapa ──
    if (method === 'POST' || method === 'PATCH') {
      const cliente_id = alvoCliente(req.body.cliente_id);
      if (!cliente_id) return res.status(400).json({ error: 'cliente_id é obrigatório para administrador.' });

      // Reenvio de um evento do histórico para a Meta: PATCH com action='resend'.
      if (req.body.action === 'resend') {
        return await reenviar(req, res, pool, cliente_id);
      }

      // Configuração geral do Rastreamento Inteligente. O cliente comum sempre
      // usa o cliente_id do token; somente o admin pode escolher outro cliente.
      if (req.body.action === 'config') {
        if (method !== 'PATCH') {
          return res.status(405).json({ error: 'Use PATCH para salvar a configuração.' });
        }
        const template_venda = String(req.body.template_venda || '').trim().slice(0, 10000) || null;
        const template_qualificacao = String(req.body.template_qualificacao || '').trim().slice(0, 255) || null;
        const config = await pool.query(
          `UPDATE clientes
           SET template_venda = $1, template_qualificacao = $2, atualizado_em = NOW()
           WHERE id = $3
           RETURNING template_venda, template_qualificacao`,
          [template_venda, template_qualificacao, cliente_id]
        );
        if (!config.rows.length) return res.status(404).json({ error: 'Cliente não encontrado.' });
        return res.status(200).json(config.rows[0]);
      }

      // Mover um lead de etapa arrastando o card no Kanban. stage_id=null volta
      // o lead para a etapa virtual "Novo" (current_stage_id NULL, sem CAPI).
      if (req.body.action === 'move_lead') {
        if (method !== 'PATCH') {
          return res.status(405).json({ error: 'Use PATCH para mover um lead.' });
        }
        return await moverLead(req, res, pool, cliente_id);
      }

      if (req.body.action === 'reorder') {
        if (method !== 'PATCH') {
          return res.status(405).json({ error: 'Use PATCH para ordenar as etapas.' });
        }
        const ids = Array.isArray(req.body.stage_ids)
          ? req.body.stage_ids.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0)
          : [];
        if (!ids.length || new Set(ids).size !== ids.length) {
          return res.status(400).json({ error: 'Informe uma ordem válida de etapas.' });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const pertencentes = await client.query(
            `SELECT id
             FROM journey_stages
             WHERE cliente_id = $1 AND tracking_campaign_id IS NULL
             FOR UPDATE`,
            [cliente_id]
          );
          const idsDoCliente = new Set(pertencentes.rows.map(row => Number(row.id)));
          if (idsDoCliente.size !== ids.length || ids.some(id => !idsDoCliente.has(id))) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'A ordem deve conter todas as etapas deste cliente.' });
          }
          for (let position = 0; position < ids.length; position++) {
            await client.query(
              `UPDATE journey_stages
               SET position = $1, updated_at = NOW()
               WHERE id = $2 AND cliente_id = $3 AND tracking_campaign_id IS NULL`,
              [position, ids[position], cliente_id]
            );
          }
          await client.query('COMMIT');
          return res.status(200).json({ ok: true, stage_ids: ids });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }

      const {
        id, name, event_concept,
        keywords = [], keyword_match = 'partial', value_regex = null,
        currency = 'BRL', position = 0, enabled = true,
        extra_events = [],
      } = req.body;

      // Gatilhos independentes: uma etapa pode disparar por palavra-chave, por
      // arraste no Kanban, ou ambos ao mesmo tempo (não é mais um enum exclusivo).
      const trigger_keyword = req.body.trigger_keyword !== false;
      const trigger_kanban_drag = req.body.trigger_kanban_drag === true;
      const color = CORES_VALIDAS.includes(req.body.color) ? req.body.color : 'neutral';
      // Tipo da etapa (independente do event_concept disparado): usados pelo
      // Funil (consolidação de vendas) e pela regra "não rebaixar" status.
      const is_first_contact = req.body.is_first_contact === true;
      const is_sale = req.body.is_sale === true;
      const google_ads_note = req.body.google_ads_note ? String(req.body.google_ads_note).trim().slice(0, 255) : null;

      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome da etapa é obrigatório.' });
      if (!CONCEITOS.includes(event_concept)) {
        return res.status(400).json({ error: `event_concept inválido. Use: ${CONCEITOS.join(', ')}` });
      }
      if (!trigger_keyword && !trigger_kanban_drag) {
        return res.status(400).json({ error: 'Ative ao menos um gatilho: palavra-chave ou arraste no Kanban.' });
      }
      const kwArray = Array.isArray(keywords)
        ? keywords.map(k => String(k).trim()).filter(Boolean)
        : String(keywords).split(',').map(k => k.trim()).filter(Boolean);
      if (trigger_keyword && !kwArray.length) {
        return res.status(400).json({ error: 'Informe pelo menos uma palavra-chave para o gatilho.' });
      }
      if (!regexValido(value_regex)) {
        return res.status(400).json({ error: 'Expressão regular de valor inválida.' });
      }

      // Eventos extras: cada um precisa de conceito válido no canal WhatsApp e
      // não pode repetir o conceito principal nem se repetir entre si (o dedup
      // de dispararEtapaJornada é por (lead, etapa, conceito) — duplicar
      // quebraria a idempotência).
      const extrasArray = Array.isArray(extra_events) ? extra_events : [];
      for (const ev of extrasArray) {
        if (!CONCEITOS.includes(ev.event_concept)) {
          return res.status(400).json({ error: `Evento extra inválido: ${ev.event_concept}` });
        }
      }
      const conceitosExtras = extrasArray.map(e => e.event_concept);
      if (conceitosExtras.includes(event_concept) || new Set(conceitosExtras).size !== conceitosExtras.length) {
        return res.status(400).json({ error: 'Eventos extras não podem repetir o evento principal nem entre si.' });
      }

      let stageRow;
      if (id) {
        // Editar (garante que a etapa é do cliente).
        const r = await pool.query(
          `UPDATE journey_stages SET
             name=$1, event_concept=$2, trigger_keyword=$3, trigger_kanban_drag=$4, keywords=$5,
             keyword_match=$6, value_regex=$7, currency=$8, position=$9, enabled=$10, color=$11,
             is_first_contact=$12, is_sale=$13, google_ads_note=$14, updated_at=NOW()
           WHERE id=$15 AND cliente_id=$16 AND tracking_campaign_id IS NULL
           RETURNING *`,
          [name.trim(), event_concept, trigger_keyword, trigger_kanban_drag, kwArray,
           keyword_match === 'exact' ? 'exact' : 'partial',
           value_regex || null, currency || 'BRL', parseInt(position, 10) || 0,
           enabled !== false, color, is_first_contact, is_sale, google_ads_note,
           parseInt(id, 10), cliente_id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Etapa não encontrada.' });
        stageRow = r.rows[0];
        await pool.query('DELETE FROM journey_stage_events WHERE stage_id = $1', [stageRow.id]);
      } else {
        const r = await pool.query(
          `INSERT INTO journey_stages
             (cliente_id, name, event_concept, trigger_keyword, trigger_kanban_drag, keywords,
              keyword_match, value_regex, currency, position, enabled, color,
              is_first_contact, is_sale, google_ads_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [cliente_id, name.trim(), event_concept, trigger_keyword, trigger_kanban_drag, kwArray,
           keyword_match === 'exact' ? 'exact' : 'partial',
           value_regex || null, currency || 'BRL', parseInt(position, 10) || 0, enabled !== false,
           color, is_first_contact, is_sale, google_ads_note]
        );
        stageRow = r.rows[0];
      }

      let extraRows = [];
      for (const ev of extrasArray) {
        const evR = await pool.query(
          `INSERT INTO journey_stage_events (stage_id, event_concept, currency)
           VALUES ($1,$2,$3) RETURNING *`,
          [stageRow.id, ev.event_concept, ev.currency || 'BRL']
        );
        extraRows.push(evR.rows[0]);
      }

      return res.status(200).json({ ...stageRow, extra_events: extraRows });
    }

    // ── DELETE: excluir etapa ──
    if (method === 'DELETE') {
      const cliente_id = alvoCliente(req.query.cliente_id);
      const id = parseInt(req.query.id, 10);
      if (!cliente_id || !id) return res.status(400).json({ error: 'id e cliente_id são obrigatórios.' });
      await pool.query(
        'DELETE FROM journey_stages WHERE id = $1 AND cliente_id = $2 AND tracking_campaign_id IS NULL',
        [id, cliente_id]
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('[journey-stages]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Reenvia um evento do histórico (que falhou) à Meta, reusando o módulo central.
// Mantém o mesmo event_id determinístico (a Meta deduplica se já tinha recebido).
async function reenviar(req, res, pool, cliente_id) {
  const histId = parseInt(req.body.history_id, 10);
  if (!histId) return res.status(400).json({ error: 'history_id é obrigatório.' });

  const r = await pool.query(
    `SELECT h.*, l.*, h.id AS hist_id, h.value AS hist_value, h.currency AS hist_currency,
            k.fbc, k.fbp, k.ip_address, k.user_agent, k.referrer,
            k.event_source_url AS click_event_source_url
     FROM lead_journey_history h
     JOIN leads_tracking l ON l.id = h.lead_id
     LEFT JOIN tracking_clicks k ON k.id = l.tracking_click_id
     WHERE h.id = $1 AND h.cliente_id = $2`,
    [histId, cliente_id]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Registro não encontrado.' });
  const row = r.rows[0];
  if (row.click_event_source_url) row.event_source_url = row.click_event_source_url;

  const capi = await enviarConversao({
    lead: row, concept: row.event_concept,
    value: row.hist_value, currency: row.hist_currency || 'BRL', pool,
  });

  await pool.query(
    `UPDATE lead_journey_history
     SET meta_status=$1, meta_response=$2, fbtrace_id=$3,
         attempts=attempts+1, last_attempt_at=NOW()
     WHERE id=$4`,
    [capi.sent ? 'sent' : 'error', capi.sent ? null : (capi.error || 'falha'),
     capi.fbtrace_id || null, histId]
  );

  return res.status(200).json({ ok: true, capi: { sent: capi.sent, error: capi.error } });
}

// Move um lead para outra etapa arrastando o card no Kanban. stage_id=null volta
// o lead para a etapa virtual "Novo" (sem CAPI). Etapa precisa ter
// trigger_kanban_drag=true — senão o gatilho de arraste não está habilitado nela.
async function moverLead(req, res, pool, cliente_id) {
  const leadId = parseInt(req.body.lead_id, 10);
  if (!leadId) return res.status(400).json({ error: 'lead_id é obrigatório.' });
  const stageId = req.body.stage_id === null || req.body.stage_id === undefined || req.body.stage_id === ''
    ? null
    : parseInt(req.body.stage_id, 10);

  const leadRes = await pool.query(
    `SELECT l.*, k.fbc, k.fbp, k.ip_address, k.user_agent, k.referrer,
            k.event_source_url AS click_event_source_url, k.tracking_id
     FROM leads_tracking l
     LEFT JOIN tracking_clicks k ON k.id = l.tracking_click_id
     WHERE l.id = $1 AND l.cliente_id = $2`,
    [leadId, cliente_id]
  );
  if (!leadRes.rows.length) return res.status(404).json({ error: 'Lead não encontrado.' });
  const lead = leadRes.rows[0];
  if (lead.click_event_source_url) lead.event_source_url = lead.click_event_source_url;

  if (stageId === null) {
    const upd = await pool.query(
      `UPDATE leads_tracking SET current_stage_id = NULL, stage_changed_at = NOW()
       WHERE id = $1 RETURNING status, current_stage_id`,
      [leadId]
    );
    return res.status(200).json({ ok: true, capi: null, lead: upd.rows[0] });
  }

  const stagesRes = await pool.query(
    `SELECT * FROM journey_stages
     WHERE cliente_id = $1 AND tracking_campaign_id IS NULL
     ORDER BY position ASC, id ASC`,
    [cliente_id]
  );
  const stage = stagesRes.rows.find(s => Number(s.id) === stageId);
  if (!stage) return res.status(404).json({ error: 'Etapa não encontrada.' });
  if (!stage.trigger_kanban_drag) {
    return res.status(400).json({
      error: 'Esta etapa não aceita mover por arraste; ative o gatilho de arraste na configuração da etapa.',
    });
  }
  if (stage.event_concept === 'purchase' || stage.event_concept === 'checkout') {
    return res.status(400).json({
      error: 'Etapas de compra/checkout exigem valor — use o botão "Venda" para registrar esta etapa.',
    });
  }

  const r = await dispararEtapaJornada({
    lead, stage, allStages: stagesRes.rows, pool, textoOrigem: null, origem: 'kanban_drag',
  });

  if (r.alreadyProcessed) {
    const atual = await pool.query(
      'SELECT status, current_stage_id FROM leads_tracking WHERE id = $1',
      [leadId]
    );
    return res.status(200).json({ ok: true, capi: { sent: true, error: null }, lead: atual.rows[0] });
  }

  return res.status(200).json({
    ok: true,
    capi: { sent: r.sent, error: r.error },
    lead: r.lead || null,
  });
}
