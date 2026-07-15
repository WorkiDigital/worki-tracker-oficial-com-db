// Schema lazy da tabela de transferência de sessão WhatsApp — mesmo padrão de
// _extension-pairing-schema.js (lock consultivo próprio, idempotente). Domínio
// separado do pareamento por código: aqui a credencial em si é transferida,
// não só autorizada — por isso vive em tabela e lock próprios.
import { getPool } from './_db.js';

let schemaPromise = null;

async function createSchema() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wa_session_transfers_v1'))");

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.wa_session_transfers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_by INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
        cliente_id INTEGER NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
        instance_name VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code VARCHAR(80),
        session_payload_enc BYTEA,
        detected_phone_hash CHAR(64),
        expires_at TIMESTAMPTZ NOT NULL,
        imported_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT wa_session_transfers_status_check CHECK (
          status IN ('CREATED','UPLOADED','IMPORTING','IMPORTED','FAILED','EXPIRED')
        )
      );

      CREATE INDEX IF NOT EXISTS idx_wa_session_transfers_instance
        ON public.wa_session_transfers(instance_name, status);
      CREATE INDEX IF NOT EXISTS idx_wa_session_transfers_expires
        ON public.wa_session_transfers(expires_at);
    `);

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function ensureSessionTransferSchema() {
  if (!schemaPromise) {
    schemaPromise = createSchema().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
