/**
 * Teste: compara os 2 métodos de obter page_id a partir do source_id.
 *  (A) atual    → creative{object_story_spec{page_id}}
 *  (B) do N8N   → tracking_specs  (busca recursiva por chave "page")
 *
 * Uso:
 *   TEST_INSTANCIA=nutri-tayna-motta node -r dotenv/config scripts/teste-tracking-specs.js
 */

import 'dotenv/config';
import pkg from 'pg';
import { createDecipheriv } from 'crypto';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INSTANCIA = process.env.TEST_INSTANCIA || null;
const GRAPH_VER = 'v25.0';

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

// Busca recursiva pela chave "page" (igual ao código do N8N)
function findPage(obj) {
  let pages = [];
  function walk(o) {
    if (o && typeof o === 'object') {
      if (o.page) pages.push(...(Array.isArray(o.page) ? o.page : [o.page]));
      for (const k in o) if (typeof o[k] === 'object') walk(o[k]);
    }
  }
  walk(obj);
  return pages;
}

async function main() {
  if (!INSTANCIA) { console.log('Defina TEST_INSTANCIA'); await pool.end(); return; }

  const lr = await pool.query(
    `SELECT source_id, cliente_id FROM leads_tracking
     WHERE instancia = $1 AND source_id IS NOT NULL AND source_id <> ''
     ORDER BY created_at DESC LIMIT 1`, [INSTANCIA]
  );
  const lead = lr.rows[0];
  if (!lead) { console.log('Sem source_id para essa instância'); await pool.end(); return; }

  const cr = await pool.query('SELECT token_meta, token_meta_enc FROM clientes WHERE id = $1', [lead.cliente_id]);
  let token = cr.rows[0]?.token_meta || null;
  if (cr.rows[0]?.token_meta_enc) {
    try { token = decryptToken(cr.rows[0].token_meta_enc); } catch (e) { console.log('decrypt erro:', e.message); }
  }
  if (!token) { console.log('Sem token'); await pool.end(); return; }

  const sid = lead.source_id;
  console.log(`source_id: ${sid}\n`);

  // (A) Método atual
  console.log('── (A) creative{object_story_spec{page_id}} ──');
  try {
    const u = `https://graph.facebook.com/${GRAPH_VER}/${sid}?fields=creative{object_story_spec{page_id}}&access_token=${token}`;
    const d = await (await fetch(u)).json();
    console.log(JSON.stringify(d, null, 2));
    console.log('→ page_id:', d.creative?.object_story_spec?.page_id || 'NULL');
  } catch (e) { console.log('erro:', e.message); }

  // (B) Método do N8N
  console.log('\n── (B) tracking_specs (método N8N) ──');
  try {
    const u = `https://graph.facebook.com/${GRAPH_VER}/${sid}?fields=tracking_specs&access_token=${token}`;
    const d = await (await fetch(u)).json();
    console.log(JSON.stringify(d, null, 2));
    const pages = findPage(d);
    console.log('→ page encontrada:', pages.length ? pages[0] : 'NULL', pages.length > 1 ? `(${pages.length} no total)` : '');
  } catch (e) { console.log('erro:', e.message); }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
