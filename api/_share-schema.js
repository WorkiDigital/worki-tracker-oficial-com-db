// Schema lazy para colunas novas em share_tokens — mesmo padrão de
// _extension-pairing-schema.js (lock consultivo, idempotente). A tabela em
// si já é criada por setup-db.js; este helper cobre colunas adicionadas
// DEPOIS da criação original em ambientes onde setup-db.js não roda a cada
// deploy (só manualmente, via terminal do EasyPanel).
import { getPool } from './_db.js';

let schemaPromise = null;

async function createSchema() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('share_tokens_currency_v1'))");

    await client.query(`
      ALTER TABLE public.share_tokens
      ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'BRL';
    `);

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function ensureShareSchema() {
  if (!schemaPromise) {
    schemaPromise = createSchema().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
