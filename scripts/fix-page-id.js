/**
 * Script retroativo: busca page_id na Graph API e reenvia evento
 * LeadSubmitted para o CAPI da Meta em leads com page_id NULL.
 *
 * Uso:
 *   node -r dotenv/config scripts/fix-page-id.js
 *
 * Filtros opcionais via env:
 *   FIX_INSTANCIA=reidosofa-contato-5645   (filtra por instância)
 *   FIX_DAYS=10                             (últimos N dias, default: 10)
 *   FIX_DRY_RUN=true                        (mostra o que faria, sem gravar/enviar)
 */

import 'dotenv/config';
import pkg from 'pg';
import crypto, { createDecipheriv } from 'crypto';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INSTANCIA = process.env.FIX_INSTANCIA || null;
const DAYS      = parseInt(process.env.FIX_DAYS || '10', 10);
const DRY_RUN   = process.env.FIX_DRY_RUN === 'true';
const GRAPH_VER = 'v25.0';
const DELAY_MS  = 350;

function decryptToken(enc) {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
  const buf       = Buffer.isBuffer(enc) ? enc : Buffer.from(enc);
  const iv        = buf.slice(0, 12);
  const tag       = buf.slice(12, 28);
  const encrypted = buf.slice(28);
  const dc = createDecipheriv('aes-256-gcm', key, iv);
  dc.setAuthTag(tag);
  return Buffer.concat([dc.update(encrypted), dc.final()]).toString('utf8');
}

const clienteCache = {};
async function getCliente(clienteId) {
  if (clienteCache[clienteId]) return clienteCache[clienteId];
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

async function fetchPageId(sourceId, token) {
  const fields = 'creative{object_story_spec{page_id}}';
  const url = `https://graph.facebook.com/${GRAPH_VER}/${sourceId}?fields=${fields}&access_token=${token}`;
  const r = await fetch(url);
  const data = await r.json();
  if (data.error) {
    process.stdout.write(`⚠️  ${data.error.message} `);
    return null;
  }
  return data.creative?.object_story_spec?.page_id || null;
}

const hash = str => crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');

async function enviarCapiLead(lead, pixel, token, pageId) {
  const ph = (lead.telefone || '').replace(/\D/g, '');
  const userData = { ctwa_clid: lead.ctw_aci_id };
  if (ph) userData.ph = [hash(ph)];
  if (pageId) userData.page_id = pageId;

  const payload = {
    data: [{
      event_name:        'LeadSubmitted',
      event_time:        Math.floor(new Date(lead.created_at).getTime() / 1000),
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      user_data:         userData,
    }]
  };

  const r = await fetch(`https://graph.facebook.com/${GRAPH_VER}/${pixel}/events?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await r.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🔧 Fix Page ID + Reenvio CAPI LeadSubmitted');
  console.log(`   Instância : ${INSTANCIA || '(todas)'}`);
  console.log(`   Período   : últimos ${DAYS} dias`);
  console.log(`   Modo      : ${DRY_RUN ? 'DRY RUN (sem gravação/envio)' : 'PRODUÇÃO'}`);
  console.log('');

  const where  = [`page_id IS NULL`, `source_id IS NOT NULL`, `source_id != ''`,
                  `ctw_aci_id IS NOT NULL`,
                  `created_at >= NOW() - INTERVAL '${DAYS} days'`];
  const params = [];
  if (INSTANCIA) { where.push(`instancia = $1`); params.push(INSTANCIA); }

  const { rows: leads } = await pool.query(
    `SELECT id, source_id, ctw_aci_id, telefone, cliente_id, nome, instancia, created_at
     FROM leads_tracking
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC`,
    params
  );

  console.log(`📋 ${leads.length} leads para corrigir\n`);
  if (!leads.length) { await pool.end(); return; }

  let fixados = 0, capiOk = 0, capiErr = 0, semDados = 0, semToken = 0;

  for (const lead of leads) {
    process.stdout.write(`  Lead #${lead.id} (${lead.nome || '?'} — ${lead.instancia}) ... `);

    const cli = await getCliente(lead.cliente_id);
    if (!cli?.token) {
      console.log('❌ sem token');
      semToken++;
      continue;
    }
    if (!cli.pixel) {
      console.log('❌ sem pixel_padrao');
      semToken++;
      continue;
    }

    // Passo 1: buscar page_id
    const pageId = await fetchPageId(lead.source_id, cli.token);
    if (!pageId) {
      console.log('— page_id não retornado');
      semDados++;
      await sleep(DELAY_MS);
      continue;
    }

    process.stdout.write(`page_id: ${pageId} `);

    if (!DRY_RUN) {
      await pool.query(
        `UPDATE leads_tracking SET page_id = $1 WHERE id = $2`,
        [pageId, lead.id]
      );
    }
    fixados++;

    // Passo 2: reenviar CAPI LeadSubmitted
    if (!DRY_RUN) {
      const resp = await enviarCapiLead(lead, cli.pixel, cli.token, pageId);
      if (resp.events_received) {
        process.stdout.write(`→ CAPI ✅\n`);
        capiOk++;
      } else {
        const errMsg = resp.error?.message || JSON.stringify(resp);
        process.stdout.write(`→ CAPI ❌ ${errMsg}\n`);
        capiErr++;
      }
    } else {
      process.stdout.write(`→ CAPI (dry run)\n`);
    }

    await sleep(DELAY_MS);
  }

  console.log('\n── Resultado ──────────────────────────');
  console.log(`✅ page_id corrigidos : ${fixados}`);
  console.log(`✅ CAPI aceitos       : ${capiOk}`);
  console.log(`❌ CAPI rejeitados    : ${capiErr}`);
  console.log(`⚠️  Sem dados (Meta)  : ${semDados}`);
  console.log(`⚠️  Sem token/pixel   : ${semToken}`);
  if (DRY_RUN) console.log('\n⚠️  DRY RUN — nada foi gravado nem enviado para a Meta.');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
