/**
 * Reclassifica is_bot_reply em chat_messages (dos últimos 15 dias — janela de
 * retenção da tabela) após uma mudança em bot_threshold_seconds. Mensagens já
 * gravadas NÃO são reclassificadas automaticamente quando o limiar muda — este
 * script existe para corrigir isso sob demanda (mesmo espírito de fix-page-id.js).
 *
 * Uso:
 *   RECALC_CLIENTE_ID=6 RECALC_DRY_RUN=true node -r dotenv/config scripts/recalc-bot-flag.js
 *
 * Variáveis de ambiente:
 *   RECALC_CLIENTE_ID — id do cliente (obrigatório)
 *   RECALC_DRY_RUN    — true = só mostra o que mudaria, sem gravar (padrão: true)
 */

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const CLIENTE_ID = process.env.RECALC_CLIENTE_ID ? parseInt(process.env.RECALC_CLIENTE_ID, 10) : null;
const DRY_RUN = process.env.RECALC_DRY_RUN !== 'false';

if (!CLIENTE_ID) {
  console.error('Informe RECALC_CLIENTE_ID.');
  process.exit(1);
}

async function main() {
  console.log('🔁 Recalcular is_bot_reply em chat_messages');
  console.log(`   Cliente : ${CLIENTE_ID}`);
  console.log(`   Modo    : ${DRY_RUN ? 'DRY RUN (sem gravação)' : 'PRODUÇÃO'}\n`);

  const settingsRes = await pool.query(
    'SELECT bot_threshold_seconds FROM engagement_settings WHERE cliente_id = $1',
    [CLIENTE_ID]
  );
  const thresholdSeconds = settingsRes.rows[0]?.bot_threshold_seconds ?? 5;
  console.log(`   Limiar atual: ${thresholdSeconds}s\n`);

  // Todas as mensagens fromMe=true dos últimos 15 dias, mais a última mensagem
  // do lead ANTES de cada uma (mesmo telefone+instance), via LATERAL join.
  const { rows } = await pool.query(
    `SELECT m.id, m.telefone, m.instance, m.message_at, m.is_bot_reply,
            prev.message_at AS prev_lead_message_at
     FROM chat_messages m
     LEFT JOIN LATERAL (
       SELECT message_at FROM chat_messages p
       WHERE p.cliente_id = m.cliente_id AND p.instance = m.instance
         AND p.telefone = m.telefone AND p.from_me = false
         AND p.message_at < m.message_at
       ORDER BY p.message_at DESC LIMIT 1
     ) prev ON true
     WHERE m.cliente_id = $1 AND m.from_me = true
       AND m.message_at >= NOW() - INTERVAL '15 days'`,
    [CLIENTE_ID]
  );

  console.log(`📋 ${rows.length} mensagens fromMe=true na janela de 15 dias\n`);

  let mudaram = 0;
  for (const row of rows) {
    let novoValor = false;
    if (row.prev_lead_message_at) {
      const gapSeconds = (new Date(row.message_at) - new Date(row.prev_lead_message_at)) / 1000;
      novoValor = gapSeconds >= 0 && gapSeconds < thresholdSeconds;
    }
    if (novoValor !== row.is_bot_reply) {
      mudaram++;
      console.log(`  Msg #${row.id} (${row.telefone}) ... is_bot_reply: ${row.is_bot_reply} → ${novoValor}`);
      if (!DRY_RUN) {
        await pool.query('UPDATE chat_messages SET is_bot_reply = $1 WHERE id = $2', [novoValor, row.id]);
      }
    }
  }

  console.log(`\n── Resultado ──────────────────`);
  console.log(`Mensagens reclassificadas: ${mudaram}`);
  if (DRY_RUN) console.log('\n⚠️  DRY RUN — nada foi gravado no banco.');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
