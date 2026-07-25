/**
 * Reenvia o evento LeadSubmitted (CAPI) em lote, para leads que JA TEM
 * page_id preenchido, filtrando por instancia + periodo. Complementa
 * fix-page-id.js (que so atua em leads com page_id NULL) e
 * resend-lead-capi.js (que so reenvia 1 lead por vez via telefone/id).
 *
 * Uso:
 *   RESEND_INSTANCIA=cliente_6_contato-rodrigo RESEND_DAYS=30 RESEND_DRY_RUN=true \
 *     node -r dotenv/config scripts/resend-leadsubmitted-batch.js
 *
 * Variaveis de ambiente:
 *   RESEND_INSTANCIA  — nome exato da instancia (obrigatorio)
 *   RESEND_DAYS       — ultimos N dias (default: 30)
 *   RESEND_DRY_RUN    — true = so mostra o que enviaria, sem chamar a Meta (padrao: true)
 */

import 'dotenv/config';
import pkg from 'pg';
import { createDecipheriv } from 'crypto';
import crypto from 'crypto';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INSTANCIA = process.env.RESEND_INSTANCIA || null;
const DAYS      = parseInt(process.env.RESEND_DAYS || '30', 10);
const DRY_RUN   = process.env.RESEND_DRY_RUN !== 'false';
const GRAPH_VER = 'v25.0';
const DELAY_MS  = 350;

if (!INSTANCIA) {
  console.error('Informe RESEND_INSTANCIA.');
  process.exit(1);
}

function decryptToken(enc) {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
  const buf = Buffer.isBuffer(enc) ? enc : Buffer.from(enc);
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const encrypted = buf.slice(28);
  const dc = createDecipheriv('aes-256-gcm', key, iv);
  dc.setAuthTag(tag);
  return Buffer.concat([dc.update(encrypted), dc.final()]).toString('utf8');
}

const hash = str => crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const clienteCache = {};
async function getCliente(clienteId) {
  if (clienteId in clienteCache) return clienteCache[clienteId];
  const r = await pool.query(
    'SELECT token_meta, token_meta_enc, pixel_padrao FROM clientes WHERE id = $1',
    [clienteId]
  );
  const row = r.rows[0];
  if (!row) { clienteCache[clienteId] = null; return null; }
  let token = row.token_meta || null;
  if (row.token_meta_enc) {
    try { token = decryptToken(row.token_meta_enc); } catch (_) {}
  }
  clienteCache[clienteId] = { token, pixel: row.pixel_padrao };
  return clienteCache[clienteId];
}

async function main() {
  console.log('🔁 Reenvio em lote de CAPI LeadSubmitted (leads com page_id já preenchido)');
  console.log(`   Instância : ${INSTANCIA}`);
  console.log(`   Período   : últimos ${DAYS} dias`);
  console.log(`   Modo      : ${DRY_RUN ? 'DRY RUN (sem envio)' : 'PRODUÇÃO'}\n`);

  const { rows: leads } = await pool.query(
    `SELECT id, nome, telefone, cliente_id, instancia, ctw_aci_id, page_id, created_at
     FROM leads_tracking
     WHERE instancia = $1
       AND ctw_aci_id IS NOT NULL
       AND page_id IS NOT NULL AND page_id <> ''
       AND created_at >= NOW() - INTERVAL '${DAYS} days'
     ORDER BY created_at DESC`,
    [INSTANCIA]
  );

  console.log(`📋 ${leads.length} leads elegíveis (com page_id preenchido)\n`);
  if (!leads.length) { await pool.end(); return; }

  let ok = 0, rejeitados = 0, semTokenPixel = 0;

  for (const lead of leads) {
    process.stdout.write(`  Lead #${lead.id} (${lead.nome || '?'} — ${lead.instancia}) ... `);

    const cli = await getCliente(lead.cliente_id);
    if (!cli?.token || !cli?.pixel) {
      console.log('❌ sem token/pixel');
      semTokenPixel++;
      continue;
    }

    const ph = (lead.telefone || '').replace(/\D/g, '');
    const userData = { ctwa_clid: lead.ctw_aci_id, page_id: lead.page_id };
    if (ph) userData.ph = [hash(ph)];

    const payload = {
      data: [{
        event_name: 'LeadSubmitted',
        event_time: Math.floor(new Date(lead.created_at).getTime() / 1000),
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: userData,
      }]
    };

    if (DRY_RUN) {
      console.log(`page_id: ${lead.page_id} → CAPI (dry run)`);
      continue;
    }

    const r = await fetch(`https://graph.facebook.com/${GRAPH_VER}/${cli.pixel}/events?access_token=${cli.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const resp = await r.json();
    if (resp.events_received) {
      console.log(`✅ CAPI aceito (fbtrace_id: ${resp.fbtrace_id})`);
      ok++;
    } else {
      // error_subcode diz a causa exata (regra do CLAUDE.md: nunca adivinhar).
      const err = resp.error || {};
      console.log(`❌ CAPI rejeitado: [subcode ${err.error_subcode || '?'}] ${err.error_user_msg || err.message} (fbtrace_id: ${err.fbtrace_id})`);
      rejeitados++;
    }
    await sleep(DELAY_MS);
  }

  console.log('\n── Resultado ──────────────────');
  console.log(`CAPI aceitos      : ${ok}`);
  console.log(`CAPI rejeitados   : ${rejeitados}`);
  console.log(`Sem token/pixel   : ${semTokenPixel}`);
  if (DRY_RUN) console.log('\n⚠️  DRY RUN — nada foi enviado para a Meta.');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
