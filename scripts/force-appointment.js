/**
 * Forca o status 'Agendado' + envia o evento AppointmentBooked (CAPI) para um
 * lead especifico, sem depender do gatilho automatico da jornada (util quando
 * o webhook nao capturou a mensagem "Reuniao confirmada" do comercial).
 *
 * Reaproveita a mesma funcao central enviarConversao usada pelo gatilho
 * automatico e pelo botao manual do painel — mesmo event_id deterministico
 * (dedup com a Meta), mesma logica de canal/page_id/hash.
 *
 * Uso:
 *   FORCE_TELEFONE=15083710839 FORCE_DRY_RUN=true node -r dotenv/config scripts/force-appointment.js
 *
 * Variaveis de ambiente:
 *   FORCE_TELEFONE  — telefone do lead (so numeros, com ou sem DDI)
 *   FORCE_LEAD_ID   — alternativa: id do lead direto (leads_tracking.id)
 *   FORCE_DRY_RUN   — true = so mostra o que faria, sem gravar/enviar (padrao: true)
 */

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import { enviarConversao } from '../api/_capi.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const TELEFONE = (process.env.FORCE_TELEFONE || '').replace(/\D/g, '') || null;
const LEAD_ID  = process.env.FORCE_LEAD_ID ? parseInt(process.env.FORCE_LEAD_ID, 10) : null;
const DRY_RUN  = process.env.FORCE_DRY_RUN !== 'false';

if (!TELEFONE && !LEAD_ID) {
  console.error('Informe FORCE_TELEFONE ou FORCE_LEAD_ID.');
  process.exit(1);
}

async function main() {
  console.log('📅 Forcar Agendamento (status + evento CAPI)');
  console.log(`   Modo: ${DRY_RUN ? 'DRY RUN (sem gravação/envio)' : 'PRODUÇÃO'}\n`);

  const where = LEAD_ID ? 'l.id = $1' : 'l.telefone = $1';
  const param = LEAD_ID || TELEFONE;

  // Mesma query usada pela jornada automatica (processarJornadaFromMe), para o
  // objeto lead ter tudo que enviarConversao precisa (fbc/fbp/tracking_id etc).
  const { rows } = await pool.query(
    `SELECT l.*, k.fbc, k.fbp, k.ip_address, k.user_agent, k.referrer,
            k.event_source_url AS click_event_source_url, k.tracking_id
     FROM leads_tracking l
     LEFT JOIN tracking_clicks k ON k.id = l.tracking_click_id
     WHERE ${where}
     ORDER BY l.created_at DESC
     LIMIT 1`,
    [param]
  );

  if (!rows.length) {
    console.log('❌ Lead não encontrado.');
    await pool.end();
    return;
  }

  const lead = rows[0];
  if (lead.click_event_source_url) lead.event_source_url = lead.click_event_source_url;

  console.log(`Lead #${lead.id} — ${lead.nome || '(sem nome)'} — ${lead.telefone} — status atual: ${lead.status}`);

  if (DRY_RUN) {
    console.log('  → (dry run) enviaria AppointmentBooked e mudaria status para "Agendado" (se não for Vendido/Qualificado).\n');
    await pool.end();
    return;
  }

  const r = await enviarConversao({ lead, concept: 'appointment', pool });
  if (r.sent) {
    console.log(`  ✅ CAPI aceito (${r.channel}, ${r.event_name}). fbtrace_id: ${r.fbtrace_id || '—'}`);
  } else {
    console.log(`  ❌ CAPI falhou: ${r.error}`);
  }

  // Mesma regra de "nao rebaixar" usada na jornada automatica: so muda para
  // 'Agendado' se o lead nao estiver ja Vendido/Qualificado.
  const upd = await pool.query(
    `UPDATE leads_tracking
     SET scheduled_at = NOW(),
         status = CASE WHEN LOWER(COALESCE(status,'')) IN ('vendido','venda_fechada','qualificado')
                       THEN status ELSE 'Agendado' END
     WHERE id = $1
     RETURNING status`,
    [lead.id]
  );
  console.log(`  📌 Status no banco: ${upd.rows[0].status}\n`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
