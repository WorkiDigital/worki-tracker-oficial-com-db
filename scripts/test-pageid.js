/**
 * Testa a busca de page_id via Graph API para um source_id específico.
 * Uso: node -r dotenv/config scripts/test-pageid.js
 */
import 'dotenv/config';
import pkg from 'pg';
import { createDecipheriv } from 'crypto';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

function decryptToken(enc) {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
  const buf  = Buffer.isBuffer(enc) ? enc : Buffer.from(enc, 'hex');
  const iv   = buf.slice(0, 16);
  const data = buf.slice(16);
  const dc   = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([dc.update(data), dc.final()]).toString('utf8');
}

async function main() {
  // Busca token da Tainá (cliente_id 7)
  const { rows } = await pool.query(
    'SELECT token_meta, token_meta_enc FROM clientes WHERE id = 7'
  );
  const row = rows[0];
  let token = row?.token_meta || null;
  if (row?.token_meta_enc) {
    try {
      token = decryptToken(row.token_meta_enc);
      console.log('✅ Token descriptografado com sucesso');
    } catch (e) {
      console.error('❌ Falha ao descriptografar token_meta_enc:', e.message);
      console.log('⚠️  Usando token_meta como fallback:', token ? `...${token.slice(-6)}` : 'NULL');
    }
  }

  console.log('Token encontrado:', token ? `...${token.slice(-6)}` : 'NULL');

  const sourceId = '120247547755990660';

  // ── Teste 1: query atual (fields usados no webhook) ──
  console.log('\n── Teste 1: query atual do webhook ──');
  const url1 = `https://graph.facebook.com/v25.0/${sourceId}`
    + `?fields=effective_object_story_id,creative{effective_object_story_id,object_story_spec{page_id}}`
    + `&access_token=${token}`;
  const r1 = await fetch(url1);
  const d1 = await r1.json();
  console.log(JSON.stringify(d1, null, 2));

  // ── Teste 2: query expandida (usada no enrich-leads-utm) ──
  console.log('\n── Teste 2: query expandida (campaign + adset + page_id) ──');
  const url2 = `https://graph.facebook.com/v25.0/${sourceId}`
    + `?fields=name,campaign_id,campaign{name},adset_id,adset{name},creative{id,name,object_story_spec{page_id}}`
    + `&access_token=${token}`;
  const r2 = await fetch(url2);
  const d2 = await r2.json();
  console.log(JSON.stringify(d2, null, 2));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
