import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { enviarConversao, CONCEPT_KEYS_WPP, CONCEPTS } from './_capi.js';

// CRUD da Jornada geral CTWA/WhatsApp (tracking_campaign_id NULL) + histórico.
// Jornadas de links são salvas transacionalmente por /api/tracking-campaigns.
// Multi-tenant: usuário comum só mexe no próprio cliente_id; admin passa
// cliente_id no body/query.

// A jornada inteligente dispara por mensagem (canal WhatsApp/CTWA): só aceita
// conceitos válidos nesse canal. Eventos só-web (Contact, ViewContent...) ficam
// na Jornada de cada link em Captação e Links, não aqui.
const CONCEITOS = CONCEPT_KEYS_WPP;
const TRIGGERS  = ['first_message', 'keyword'];

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
      return res.status(200).json(r.rows);
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
        id, name, event_concept, trigger_type = 'keyword',
        keywords = [], keyword_match = 'partial', value_regex = null,
        currency = 'BRL', position = 0, enabled = true,
      } = req.body;

      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome da etapa é obrigatório.' });
      if (!CONCEITOS.includes(event_concept)) {
        return res.status(400).json({ error: `event_concept inválido. Use: ${CONCEITOS.join(', ')}` });
      }
      if (!TRIGGERS.includes(trigger_type)) {
        return res.status(400).json({ error: `trigger_type inválido. Use: ${TRIGGERS.join(', ')}` });
      }
      const kwArray = Array.isArray(keywords)
        ? keywords.map(k => String(k).trim()).filter(Boolean)
        : String(keywords).split(',').map(k => k.trim()).filter(Boolean);
      if (trigger_type === 'keyword' && !kwArray.length) {
        return res.status(400).json({ error: 'Informe pelo menos uma palavra-chave para o gatilho.' });
      }
      if (!regexValido(value_regex)) {
        return res.status(400).json({ error: 'Expressão regular de valor inválida.' });
      }

      if (id) {
        // Editar (garante que a etapa é do cliente).
        const r = await pool.query(
          `UPDATE journey_stages SET
             name=$1, event_concept=$2, trigger_type=$3, keywords=$4, keyword_match=$5,
             value_regex=$6, currency=$7, position=$8, enabled=$9, updated_at=NOW()
           WHERE id=$10 AND cliente_id=$11 AND tracking_campaign_id IS NULL
           RETURNING *`,
          [name.trim(), event_concept, trigger_type, kwArray,
           keyword_match === 'exact' ? 'exact' : 'partial',
           value_regex || null, currency || 'BRL', parseInt(position, 10) || 0,
           enabled !== false, parseInt(id, 10), cliente_id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Etapa não encontrada.' });
        return res.status(200).json(r.rows[0]);
      }

      const r = await pool.query(
        `INSERT INTO journey_stages
           (cliente_id, name, event_concept, trigger_type, keywords, keyword_match,
            value_regex, currency, position, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [cliente_id, name.trim(), event_concept, trigger_type, kwArray,
         keyword_match === 'exact' ? 'exact' : 'partial',
         value_regex || null, currency || 'BRL', parseInt(position, 10) || 0, enabled !== false]
      );
      return res.status(200).json(r.rows[0]);
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
