/**
 * Reenvia o evento LeadSubmitted (CAPI) para leads que JA TEM page_id
 * preenchido (ex: corrigido manualmente no banco). Complementa o
 * fix-page-id.js, que so atua em leads com page_id NULL.
 *
 * Uso:
 *   RESEND_TELEFONE=14259702558 RESEND_DRY_RUN=true node -r dotenv/config scripts/resend-lead-capi.js
 *
 * Variaveis de ambiente:
 *   RESEND_TELEFONE   — telefone do lead (aceita so numeros, com ou sem DDI)
 *   RESEND_LEAD_ID    — alternativa: id do lead direto (id da leads_tracking)
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

const TELEFONE  = (process.env.RESEND_TELEFONE || '').replace(/\D/g, '') || null;
const LEAD_ID   = process.env.RESEND_LEAD_ID ? parseInt(process.env.RESEND_LEAD_ID, 10) : null;
const DRY_RUN   = process.env.RESEND_DRY_RUN !== 'false';
const GRAPH_VER = 'v25.0';

if (!TELEFONE && !LEAD_ID) {
  console.error('Informe RESEND_TELEFONE ou RESEND_LEAD_ID.');
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

async function main() {
  console.log('🔁 Reenvio manual de CAPI LeadSubmitted');
  console.log(`   Modo: ${DRY_RUN ? 'DRY RUN (sem envio)' : 'PRODUÇÃO'}\n`);

  const where = LEAD_ID ? 'id = $1' : 'telefone = $1';
  const param = LEAD_ID || TELEFONE;

  const { rows } = await pool.query(
    `SELECT id, nome, telefone, cliente_id, instancia, ctw_aci_id, page_id, created_at
     FROM leads_tracking
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT 5`,
    [param]
  );

  if (!rows.length) {
    console.log('❌ Nenhum lead encontrado com esse filtro.');
    await pool.end();
    return;
  }

  for (const lead of rows) {
    console.log(`Lead #${lead.id} — ${lead.nome || '(sem nome)'} — ${lead.telefone} — instância: ${lead.instancia}`);

    if (!lead.ctw_aci_id) {
      console.log('  ⚠️  Sem ctw_aci_id (não é lead de anúncio CTWA) — pulando.\n');
      continue;
    }
    if (!lead.page_id) {
      console.log('  ⚠️  page_id ainda NULL — rode fix-page-id.js antes.\n');
      continue;
    }

    const cliRes = await pool.query(
      'SELECT token_meta, token_meta_enc, pixel_padrao FROM clientes WHERE id = $1',
      [lead.cliente_id]
    );
    const cli = cliRes.rows[0];
    let token = cli?.token_meta || null;
    if (cli?.token_meta_enc) {
      try { token = decryptToken(cli.token_meta_enc); } catch (e) { console.log('  ❌ Falha ao descriptografar token:', e.message); }
    }
    if (!token || !cli?.pixel_padrao) {
      console.log('  ❌ Cliente sem token/pixel configurado — pulando.\n');
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

    console.log(`  page_id: ${lead.page_id}`);
    console.log(`  payload:`, JSON.stringify(payload));

    if (DRY_RUN) {
      console.log('  → (dry run, não enviado)\n');
      continue;
    }

    const r = await fetch(`https://graph.facebook.com/${GRAPH_VER}/${cli.pixel_padrao}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const resp = await r.json();
    if (resp.events_received) {
      console.log(`  ✅ CAPI aceito. fbtrace_id: ${resp.fbtrace_id}\n`);
    } else {
      console.log(`  ❌ CAPI rejeitado:`, JSON.stringify(resp), '\n');
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
