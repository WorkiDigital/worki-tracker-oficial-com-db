/**
 * Dispara uma etapa da Jornada (journey_stages) para um lead: idempotência,
 * marcação de etapas anteriores como "skipped", envio à Meta via enviarConversao
 * e atualização de current_stage_id/status no lead.
 *
 * Extraído de processarJornadaFromMe (api/webhook-evo.js) para ser reusado tanto
 * pelo gatilho por palavra-chave (mensagem do WhatsApp) quanto pelo gatilho de
 * arraste no Kanban (api/journey-stages.js, action=move_lead) — mesma etapa pode
 * ter os dois gatilhos ativos ao mesmo tempo; o event_id determinístico do
 * enviarConversao garante que a Meta nunca recebe o mesmo evento duas vezes.
 */
import { enviarConversao, extrairValor } from './_capi.js';

function resolverCanalLocal(lead) {
  return lead.ctw_aci_id ? 'business_messaging' : 'website';
}

export async function dispararEtapaJornada({ lead, stage, allStages, pool, textoOrigem = null, origem = 'keyword' }) {
  const alvo = stage;
  const clienteId = lead.cliente_id;

  // Já existe histórico dessa etapa para esse lead? (idempotência app-level)
  const jaRes = await pool.query(
    'SELECT value FROM lead_journey_history WHERE lead_id = $1 AND stage_id = $2 LIMIT 1',
    [lead.id, alvo.id]
  );
  if (jaRes.rows.length) {
    if (alvo.event_concept === 'purchase' && lead.valor_venda == null && jaRes.rows[0].value != null) {
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

  // Envia à Meta (canal decidido pelo módulo central) e registra o resultado.
  const r = await enviarConversao({
    lead, concept: alvo.event_concept, value, currency: alvo.currency || 'BRL', pool,
  });

  await pool.query(
    `INSERT INTO lead_journey_history
      (lead_id, cliente_id, stage_id, event_concept, event_name, trigger_message, value, currency,
       channel, event_id, meta_status, meta_response, fbtrace_id, attempts, created_at, last_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,NOW(),NOW())
     ON CONFLICT (lead_id, stage_id) DO UPDATE
       SET meta_status = EXCLUDED.meta_status, meta_response = EXCLUDED.meta_response,
           fbtrace_id = EXCLUDED.fbtrace_id, attempts = lead_journey_history.attempts + 1,
           last_attempt_at = NOW()`,
    [lead.id, clienteId, alvo.id, alvo.event_concept, r.event_name, textoOrigem ? textoOrigem.slice(0, 500) : null,
     value, alvo.currency || 'BRL', r.channel, r.event_id,
     r.sent ? 'sent' : 'error', r.sent ? null : (r.error || 'falha'), r.fbtrace_id || null]
  );

  // Atualiza a etapa atual do lead (e scheduled_at p/ agendamento).
  const updateLeadParams = [alvo.id, lead.id];
  if (alvo.event_concept === 'purchase') updateLeadParams.push(value);
  const updRes = await pool.query(
    `UPDATE leads_tracking
     SET current_stage_id = $1, stage_changed_at = NOW()
         ${alvo.event_concept === 'appointment' ? `, scheduled_at = NOW()
           -- Marca 'Agendado' SEM rebaixar: se o lead ja e Vendido/Qualificado
           -- (estagios mais avancados no funil), preserva o status atual.
           , status = CASE WHEN LOWER(COALESCE(status,'')) IN ('vendido','venda_fechada','qualificado')
                           THEN status ELSE 'Agendado' END` : ''}
         ${alvo.event_concept === 'qualified' ? ', qualified_at = COALESCE(qualified_at, NOW())' : ''}
         ${alvo.event_concept === 'purchase' ? ", sale_closed_at = COALESCE(sale_closed_at, NOW()), status = 'Vendido', valor_venda = COALESCE(valor_venda, $3)" : ''}
     WHERE id = $2
     RETURNING status, current_stage_id`,
    updateLeadParams
  );

  return {
    sent: r.sent,
    error: r.error,
    fbtrace_id: r.fbtrace_id,
    event_name: r.event_name,
    channel: r.channel,
    lead: updRes.rows[0],
  };
}
