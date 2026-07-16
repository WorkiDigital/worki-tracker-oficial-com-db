import { getPool } from './_db.js';

let schemaPromise = null;

async function createSchema() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wa_session_transfers_v2'))");

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.wa_session_transfers (
        id UUID PRIMARY KEY,
        code_hash CHAR(64),
        token_jti UUID,
        created_by INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
        cliente_id INTEGER NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
        instance_name VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code VARCHAR(80),
        session_payload_enc BYTEA,
        detected_phone_hash CHAR(64),
        previous_session_creds_enc BYTEA,
        previous_session_existed BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ NOT NULL,
        connection_deadline_at TIMESTAMPTZ,
        claimed_at TIMESTAMPTZ,
        imported_at TIMESTAMPTZ,
        connected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE public.wa_session_transfers
        ADD COLUMN IF NOT EXISTS code_hash CHAR(64),
        ADD COLUMN IF NOT EXISTS token_jti UUID,
        ADD COLUMN IF NOT EXISTS previous_session_creds_enc BYTEA,
        ADD COLUMN IF NOT EXISTS previous_session_existed BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS connection_deadline_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

      ALTER TABLE public.wa_session_transfers
        DROP CONSTRAINT IF EXISTS wa_session_transfers_status_check;

      ALTER TABLE public.wa_session_transfers
        ADD CONSTRAINT wa_session_transfers_status_check CHECK (
          status IN (
            'CREATED','EXCHANGED','UPLOADED','IMPORTING','CONNECTING',
            'IMPORTED','CONNECTED','FAILED','EXPIRED'
          )
        );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_session_transfers_code
        ON public.wa_session_transfers(code_hash) WHERE code_hash IS NOT NULL;
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
