/**
 * Dispara uma etapa da Jornada (journey_stages) para um lead: idempotência,
 * marcação de etapas anteriores como "skipped", envio à Meta via enviarConversao
 * (evento principal + eventos extras de journey_stage_events) e atualização de
 * current_stage_id/status no lead.
 *
 * Reusado tanto pelo gatilho por palavra-chave (mensagem do WhatsApp) quanto
 * pelo gatilho de arraste no Kanban (api/journey-stages.js, action=move_lead) —
 * mesma etapa pode ter os dois gatilhos ativos ao mesmo tempo; o event_id
 * determinístico do enviarConversao garante que a Meta nunca recebe o mesmo
 * evento duas vezes.
 *
 * Google Ads NÃO é disparado aqui: é 100% client-side (gtag.js) no momento do
 * clique/pageview, sem API server-side equivalente à CAPI da Meta. O campo
 * stage.google_ads_note é só metadado informativo (ver CONCEPTS em _capi.js).
 */
import { enviarConversao, extrairValor } from './_capi.js';

function resolverCanalLocal(lead) {
  return lead.ctw_aci_id ? 'business_messaging' : 'website';
}

// Envia um único conceito e grava o resultado em lead_journey_history.
// extraEventId != null identifica um evento ADICIONAL da etapa (journey_stage_events);
// nesse caso o dedup usa stage_event_extra_id em vez de (lead_id, stage_id).
async function enviarEGravar({ lead, stageId, clienteId, concept, value, currency, textoOrigem, pool, extraEventId = null }) {
  const r = await enviarConversao({ lead, concept, value, currency: currency || 'BRL', pool });

  if (extraEventId === null) {
    await pool.query(
      `INSERT INTO lead_journey_history
        (lead_id, cliente_id, stage_id, event_concept, event_name, trigger_message, value, currency,
         channel, event_id, meta_status, meta_response, fbtrace_id, attempts, created_at, last_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,NOW(),NOW())
       ON CONFLICT (lead_id, stage_id) DO UPDATE
         SET meta_status = EXCLUDED.meta_status, meta_response = EXCLUDED.meta_response,
             fbtrace_id = EXCLUDED.fbtrace_id, attempts = lead_journey_history.attempts + 1,
             last_attempt_at = NOW()`,
      [lead.id, clienteId, stageId, concept, r.event_name, textoOrigem ? textoOrigem.slice(0, 500) : null,
       value, currency || 'BRL', r.channel, r.event_id,
       r.sent ? 'sent' : 'error', r.sent ? null : (r.error || 'falha'), r.fbtrace_id || null]
    );
  } else {
    // Evento extra: stage_id continua apontando pra etapa (auditoria/listagem),
    // mas o dedup real é por event_id (determinístico por extraEventId), então
    // não colide com a UNIQUE(lead_id, stage_id) do evento principal — usamos
    // ON CONFLICT (lead_id, stage_id) DO NOTHING seria errado aqui (colidiria
    // com o principal), então extras usam INSERT simples protegido por um
    // SELECT prévio de idempotência (ver dispararEtapaJornada).
    await pool.query(
      `INSERT INTO lead_journey_history
        (lead_id, cliente_id, stage_id, event_concept, event_name, trigger_message, value, currency,
         channel, event_id, meta_status, meta_response, fbtrace_id, attempts, created_at, last_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,NOW(),NOW())`,
      [lead.id, clienteId, stageId, concept, r.event_name, textoOrigem ? textoOrigem.slice(0, 500) : null,
       value, currency || 'BRL', r.channel, r.event_id,
       r.sent ? 'sent' : 'error', r.sent ? null : (r.error || 'falha'), r.fbtrace_id || null]
    );
  }

  return r;
}

export async function dispararEtapaJornada({ lead, stage, allStages, pool, textoOrigem = null, origem = 'keyword' }) {
  const alvo = stage;
  const clienteId = lead.cliente_id;

  // Já existe histórico do evento PRINCIPAL dessa etapa para esse lead? (idempotência)
  const jaRes = await pool.query(
    'SELECT value FROM lead_journey_history WHERE lead_id = $1 AND stage_id = $2 LIMIT 1',
    [lead.id, alvo.id]
  );
  if (jaRes.rows.length) {
    if (alvo.is_sale && lead.valor_venda == null && jaRes.rows[0].value != null) {
      await pool.query(
        `UPDATE leads_tracking
         SET sale_closed_at = COALESCE(sale_closed_at, NOW()),
             status = 'Vendido',
             valor_venda = COALESCE(valor_venda, $2)
         WHERE id = $1`,
        [lead.id, jaRes.rows[0].value]
      );
    }
    return { sent: false, alreadyProcessed: true };
  }

  // Sequencial permitindo pular: etapas ANTERIORES (position menor) ainda sem
  // histórico viram 'skipped' (concluídas sem reenviar evento à Meta).
  if (Array.isArray(allStages) && allStages.length) {
    const anteriores = allStages.filter(s => (s.position ?? 0) < (alvo.position ?? 0));
    for (const ant of anteriores) {
      await pool.query(
        `INSERT INTO lead_journey_history (lead_id, cliente_id, stage_id, event_concept, meta_status, created_at)
         VALUES ($1,$2,$3,$4,'skipped',NOW())
         ON CONFLICT (lead_id, stage_id) DO NOTHING`,
        [lead.id, clienteId, ant.id, ant.event_concept]
      );
    }
  }

  // Valor (se a etapa tem regex e há texto de origem). Se exigir valor e não
  // extrair → erro, não envia. Sem textoOrigem (ex: drag no Kanban), value fica null.
  let value = null;
  const exigeValor = alvo.event_concept === 'purchase' || alvo.event_concept === 'checkout';
  if (alvo.value_regex && textoOrigem) value = extrairValor(textoOrigem, alvo.value_regex);
  if (exigeValor && alvo.value_regex && textoOrigem && value == null) {
    await pool.query(
      `INSERT INTO lead_journey_history
        (lead_id, cliente_id, stage_id, event_concept, trigger_message, channel, meta_status, meta_response, created_at, last_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,'error','Valor não extraído da mensagem',NOW(),NOW())
       ON CONFLICT (lead_id, stage_id) DO NOTHING`,
      [lead.id, clienteId, alvo.id, alvo.event_concept, textoOrigem.slice(0, 500), resolverCanalLocal(lead)]
    );
    return { sent: false, error: 'Valor não extraído da mensagem' };
  }

  // Evento PRINCIPAL da etapa.
  const principal = await enviarEGravar({
    lead, stageId: alvo.id, clienteId, concept: alvo.event_concept,
    value, currency: alvo.currency, textoOrigem, pool,
  });

  // Eventos EXTRAS da etapa (journey_stage_events) — disparados em paralelo,
  // cada um com seu próprio conceito. Falha num extra não afeta o principal
  // nem os demais extras (best-effort, mesmo espírito de enviarConversao).
  const extrasRes = await pool.query(
    'SELECT id, event_concept, currency FROM journey_stage_events WHERE stage_id = $1 ORDER BY id ASC',
    [alvo.id]
  );
  for (const extra of extrasRes.rows) {
    const jaExtra = await pool.query(
      `SELECT 1 FROM lead_journey_history
       WHERE lead_id = $1 AND stage_id = $2 AND event_concept = $3 LIMIT 1`,
      [lead.id, alvo.id, extra.event_concept]
    );
    if (jaExtra.rows.length) continue;
    try {
      await enviarEGravar({
        lead, stageId: alvo.id, clienteId, concept: extra.event_concept,
        value: exigeValor ? value : null, currency: extra.currency, textoOrigem, pool,
        extraEventId: extra.id,
      });
    } catch (e) {
      // best-effort: um evento extra falhando não deve derrubar o disparo da etapa
    }
  }

  // Atualiza a etapa atual do lead (e scheduled_at p/ agendamento). Usa as flags
  // is_first_contact/is_sale (tipo da etapa) em vez de comparar event_concept
  // diretamente — permite etapa "venda" sem o conceito ser necessariamente 'purchase'.
  const updateLeadParams = [alvo.id, lead.id];
  if (alvo.is_sale) updateLeadParams.push(value);
  const updRes = await pool.query(
    `UPDATE leads_tracking
     SET current_stage_id = $1, stage_changed_at = NOW()
         ${alvo.event_concept === 'appointment' ? `, scheduled_at = NOW()
           -- Marca 'Agendado' SEM rebaixar: se o lead ja e Vendido/Qualificado
           -- (estagios mais avancados no funil), preserva o status atual.
           , status = CASE WHEN LOWER(COALESCE(status,'')) IN ('vendido','venda_fechada','qualificado')
                           THEN status ELSE 'Agendado' END` : ''}
         ${alvo.event_concept === 'qualified' ? ', qualified_at = COALESCE(qualified_at, NOW())' : ''}
         ${alvo.is_sale ? ", sale_closed_at = COALESCE(sale_closed_at, NOW()), status = 'Vendido', valor_venda = COALESCE(valor_venda, $3)" : ''}
     WHERE id = $2
     RETURNING status, current_stage_id`,
    updateLeadParams
  );

  return {
    sent: principal.sent,
    error: principal.error,
    fbtrace_id: principal.fbtrace_id,
    event_name: principal.event_name,
    channel: principal.channel,
    lead: updRes.rows[0],
  };
}
