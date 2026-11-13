// Schema lazy do MCP de leitura (chaves de acesso + auditoria).
// Mesmo padrão de _share-schema.js: lock consultivo, idempotente, chamado pelo próprio endpoint.
import { getPool } from './_db.js';

let schemaPromise = null;

async function createSchema() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('mcp_schema_v1'))");

    // Só o HASH da chave é guardado; a chave completa aparece uma única vez, na criação.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.mcp_api_keys (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(120) NOT NULL,
        key_hash CHAR(64) NOT NULL UNIQUE,
        last4 VARCHAR(8) NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP,
        revoked_at TIMESTAMP
      );
    `);

    // Escopo: chaves nascem SEM acesso a dados pessoais (nome/telefone de leads).
    await client.query(`
      ALTER TABLE public.mcp_api_keys
      ADD COLUMN IF NOT EXISTS allow_pii BOOLEAN DEFAULT FALSE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.mcp_audit_log (
        id BIGSERIAL PRIMARY KEY,
        key_id INTEGER,
        tool VARCHAR(80),
        cliente_id INTEGER,
        args JSONB,
        ok BOOLEAN DEFAULT TRUE,
        error TEXT,
        duration_ms INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mcp_audit_created ON public.mcp_audit_log(created_at DESC);
    `);

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function ensureMcpSchema() {
  if (!schemaPromise) {
    schemaPromise = createSchema().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
