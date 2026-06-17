/**
 * Migra token_meta (texto puro legado) para token_meta_enc (AES-256-GCM).
 * Atualiza também token_last4 e token_updated_at.
 * Uso: node -r dotenv/config scripts/migrate-tokens.js
 */
import 'dotenv/config';
import pkg from 'pg';
import crypto from 'crypto';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

function encryptToken(plain) {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

async function main() {
  console.log('🔐 Migração de tokens legados → criptografados\n');

  // Busca clientes que têm token_meta mas não têm token_meta_enc
  const { rows } = await pool.query(`
    SELECT id, nome, token_meta
    FROM clientes
    WHERE token_meta IS NOT NULL
      AND token_meta_enc IS NULL
    ORDER BY id
  `);

  console.log(`📋 ${rows.length} cliente(s) para migrar\n`);

  if (!rows.length) {
    console.log('✅ Nenhum cliente precisa de migração.');
    await pool.end();
    return;
  }

  for (const row of rows) {
    try {
      const enc      = encryptToken(row.token_meta);
      const last4    = row.token_meta.slice(-6);

      await pool.query(`
        UPDATE clientes
        SET token_meta_enc  = $1,
            token_last4     = $2,
            token_updated_at = NOW()
        WHERE id = $3
      `, [enc, last4, row.id]);

      console.log(`✅ ${row.nome} (id ${row.id}) — token_last4: ${last4}`);
    } catch (e) {
      console.error(`❌ ${row.nome} (id ${row.id}) — erro: ${e.message}`);
    }
  }

  console.log('\n✅ Migração concluída.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
