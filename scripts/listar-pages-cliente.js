/**
 * Lista as páginas (page_id) acessíveis pelo token de um cliente.
 * Útil quando os anúncios não retornam object_story_spec.page_id e
 * não há page_id dominante no banco (ex: cliente novo).
 *
 * Uso:
 *   LIST_INSTANCIA=nutri-tayna-motta node -r dotenv/config scripts/listar-pages-cliente.js
 *   LIST_CLIENTE_ID=12 node -r dotenv/config scripts/listar-pages-cliente.js
 */

import 'dotenv/config';
import pkg from 'pg';
import { createDecipheriv } from 'crypto';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INSTANCIA  = process.env.LIST_INSTANCIA || null;
const CLIENTE_ID = process.env.LIST_CLIENTE_ID || null;
const GRAPH_VER  = 'v25.0';

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

async function resolverClienteId() {
  if (CLIENTE_ID) return parseInt(CLIENTE_ID, 10);
  if (INSTANCIA) {
    const r = await pool.query(
      'SELECT DISTINCT cliente_id FROM leads_tracking WHERE instancia = $1 LIMIT 1',
      [INSTANCIA]
    );
    return r.rows[0]?.cliente_id || null;
  }
  return null;
}

async function main() {
  const clienteId = await resolverClienteId();
  if (!clienteId) { console.log('❌ Cliente não encontrado'); await pool.end(); return; }

  const r = await pool.query(
    'SELECT nome, token_meta, token_meta_enc FROM clientes WHERE id = $1', [clienteId]
  );
  const row = r.rows[0];
  if (!row) { console.log('❌ Cliente sem registro'); await pool.end(); return; }

  let token = row.token_meta || null;
  if (row.token_meta_enc) {
    try { token = decryptToken(row.token_meta_enc); } catch (e) { console.log('⚠️  Erro decrypt:', e.message); }
  }
  if (!token) { console.log('❌ Cliente sem token'); await pool.end(); return; }

  console.log(`🔎 Cliente: ${row.nome} (id ${clienteId})\n`);

  // 0. Testa um source_id real do cliente — mostra TODOS os caminhos de page_id
  console.log('── Teste de source_id real (payload cru) ──');
  try {
    const lr = await pool.query(
      `SELECT source_id FROM leads_tracking
       WHERE cliente_id = $1 AND source_id IS NOT NULL AND source_id <> ''
       ORDER BY created_at DESC LIMIT 1`, [clienteId]
    );
    const sid = lr.rows[0]?.source_id;
    if (!sid) console.log('  (sem source_id no banco)');
    else {
      console.log(`  source_id: ${sid}`);
      // Pede vários campos onde o page_id pode estar
      const fields = 'name,object_story_spec{page_id},effective_object_story_id,'
        + 'creative{object_story_spec{page_id},effective_object_story_id,object_story_id},'
        + 'adset{promoted_object{page_id}},campaign{name}';
      const u = `https://graph.facebook.com/${GRAPH_VER}/${sid}?fields=${fields}&access_token=${token}`;
      const d = await (await fetch(u)).json();
      console.log('  Resposta crua:');
      console.log(JSON.stringify(d, null, 2).split('\n').map(l => '    ' + l).join('\n'));
    }
  } catch (e) { console.log('  erro:', e.message); }

  // 1. Páginas que o usuário do token administra
  console.log('\n');
  console.log('── /me/accounts (páginas do usuário) ──');
  try {
    const u = `https://graph.facebook.com/${GRAPH_VER}/me/accounts?fields=id,name,category&access_token=${token}`;
    const d = await (await fetch(u)).json();
    if (d.error) console.log('  ⚠️ ', d.error.message);
    else if (!d.data?.length) console.log('  (nenhuma página retornada)');
    else d.data.forEach(p => console.log(`  page_id: ${p.id}  —  ${p.name} (${p.category || '?'})`));
  } catch (e) { console.log('  erro:', e.message); }

  // 2. Contas de anúncio → páginas promovidas
  console.log('\n── /me/adaccounts (contas de anúncio) ──');
  try {
    const u = `https://graph.facebook.com/${GRAPH_VER}/me/adaccounts?fields=id,name&access_token=${token}`;
    const d = await (await fetch(u)).json();
    if (d.error) console.log('  ⚠️ ', d.error.message);
    else if (!d.data?.length) console.log('  (nenhuma conta retornada)');
    else {
      for (const acc of d.data) {
        console.log(`  ${acc.id} — ${acc.name}`);
        const pu = `https://graph.facebook.com/${GRAPH_VER}/${acc.id}/promote_pages?fields=id,name&access_token=${token}`;
        const pd = await (await fetch(pu)).json();
        if (pd.data?.length) pd.data.forEach(p => console.log(`     ↳ page_id: ${p.id} — ${p.name}`));
      }
    }
  } catch (e) { console.log('  erro:', e.message); }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
