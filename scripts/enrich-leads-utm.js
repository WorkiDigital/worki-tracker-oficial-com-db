/**
 * Script retroativo: busca campanha/conjunto/anúncio na Graph API da Meta
 * e popula utm_campaign, utm_medium, utm_content nos leads sem UTM.
 *
 * Uso:
 *   node -r dotenv/config scripts/enrich-leads-utm.js
 *
 * Filtros opcionais via env:
 *   ENRICH_INSTANCIA=nutri-tayna-motta   (filtra por instância)
 *   ENRICH_DAYS=5                        (últimos N dias, default: 5)
 *   ENRICH_DRY_RUN=true                  (mostra o que faria, sem gravar)
 */

import 'dotenv/config';
import pkg from 'pg';
import { createDecipheriv } from 'crypto';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INSTANCIA  = process.env.ENRICH_INSTANCIA || null;
const DAYS       = parseInt(process.env.ENRICH_DAYS || '5', 10);
const DRY_RUN    = process.env.ENRICH_DRY_RUN === 'true';
const GRAPH_VER  = 'v25.0';
const DELAY_MS   = 300; // pausa entre chamadas para não estourar rate limit

function decryptToken(enc) {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
  const buf  = Buffer.isBuffer(enc) ? enc : Buffer.from(enc, 'hex');
  const iv   = buf.slice(0, 16);
  const data = buf.slice(16);
  const dc   = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([dc.update(data), dc.final()]).toString('utf8');
}

async function getToken(clienteId) {
  const r = await pool.query(
    'SELECT token_meta, token_meta_enc FROM clientes WHERE id = $1',
    [clienteId]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.token_meta_enc) {
    try { return decryptToken(row.token_meta_enc); } catch (_) {}
  }
  return row.token_meta || process.env.META_ADS_TOKEN || null;
}

async function fetchAdInfo(sourceId, token) {
  const fields = 'name,campaign_id,campaign{name},adset_id,adset{name}';
  const url = `https://graph.facebook.com/${GRAPH_VER}/${sourceId}?fields=${fields}&access_token=${token}`;
  const r = await fetch(url);
  const data = await r.json();
  if (data.error) {
    console.warn(`  ⚠️  Meta erro para source_id ${sourceId}: ${data.error.message}`);
    return null;
  }
  return {
    ad_name:       data.name              || null,
    campaign_id:   data.campaign_id       || null,
    campaign_name: data.campaign?.name    || null,
    adset_id:      data.adset_id          || null,
    adset_name:    data.adset?.name       || null,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🔍 Enrich Leads UTM');
  console.log(`   Instância : ${INSTANCIA || '(todas)'}`);
  console.log(`   Período   : últimos ${DAYS} dias`);
  console.log(`   Modo      : ${DRY_RUN ? 'DRY RUN (sem gravação)' : 'PRODUÇÃO'}`);
  console.log('');

  // Buscar leads sem UTM
  const where  = [`utm_campaign IS NULL`, `source_id IS NOT NULL`,
                  `created_at >= NOW() - INTERVAL '${DAYS} days'`];
  const params = [];
  if (INSTANCIA) { where.push(`instancia = $1`); params.push(INSTANCIA); }

  const { rows: leads } = await pool.query(
    `SELECT id, source_id, cliente_id, nome, instancia
     FROM leads_tracking
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC`,
    params
  );

  console.log(`📋 ${leads.length} leads para enriquecer\n`);
  if (!leads.length) { await pool.end(); return; }

  // Cache de tokens por cliente para não buscar repetido
  const tokenCache = {};

  let atualizados = 0, erros = 0, semDados = 0;

  for (const lead of leads) {
    process.stdout.write(`  Lead #${lead.id} (${lead.nome || lead.source_id}) ... `);

    // Token do cliente
    if (!tokenCache[lead.cliente_id]) {
      tokenCache[lead.cliente_id] = await getToken(lead.cliente_id);
    }
    const token = tokenCache[lead.cliente_id];
    if (!token) {
      console.log('❌ sem token para cliente', lead.cliente_id);
      erros++;
      continue;
    }

    // Consultar Graph API
    const info = await fetchAdInfo(lead.source_id, token);
    if (!info || (!info.campaign_name && !info.ad_name)) {
      console.log('— sem dados na Meta');
      semDados++;
      await sleep(DELAY_MS);
      continue;
    }

    console.log(`✅ ${info.campaign_name || '?'} / ${info.adset_name || '?'} / ${info.ad_name || '?'}`);

    if (!DRY_RUN) {
      await pool.query(
        `UPDATE leads_tracking
         SET utm_campaign = $1,
             utm_medium   = $2,
             utm_content  = $3
         WHERE id = $4`,
        [info.campaign_name, info.adset_name, info.ad_name, lead.id]
      );
    }

    atualizados++;
    await sleep(DELAY_MS);
  }

  console.log('\n── Resultado ──────────────────────');
  console.log(`✅ Atualizados : ${atualizados}`);
  console.log(`⚠️  Sem dados   : ${semDados}`);
  console.log(`❌ Erros        : ${erros}`);
  if (DRY_RUN) console.log('\n⚠️  DRY RUN — nada foi gravado no banco.');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
