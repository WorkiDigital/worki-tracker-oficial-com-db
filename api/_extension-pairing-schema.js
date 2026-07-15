// Schema lazy da tabela de pareamento da extensão Chrome — mesmo padrão de
// api/_tracking-schema.js (lock consultivo, idempotente, chamado no início de
// cada endpoint que depende da tabela). Separado do tracking porque é um
// domínio diferente (autorização de extensão, não campanhas/cliques).
import { getPool } from './_db.js';

let schemaPromise = null;

async function createSchema() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wa_extension_pairings_v1'))");

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.wa_extension_pairings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code_hash CHAR(64) UNIQUE NOT NULL,
        token_jti UUID,
        created_by INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
        cliente_id INTEGER NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
        instance_name VARCHAR(255) NOT NULL,
        expected_phone VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code VARCHAR(80),
        pairing_code_enc BYTEA,
        pairing_expires_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        connected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT wa_extension_pairings_status_check CHECK (
          status IN ('CREATED','EXCHANGED','WAITING','CONNECTING','CONNECTED','FAILED','EXPIRED')
        )
      );

      CREATE INDEX IF NOT EXISTS idx_wa_extension_pairings_code
        ON public.wa_extension_pairings(code_hash);
      CREATE INDEX IF NOT EXISTS idx_wa_extension_pairings_instance
        ON public.wa_extension_pairings(instance_name, status);
      CREATE INDEX IF NOT EXISTS idx_wa_extension_pairings_expires
        ON public.wa_extension_pairings(expires_at);
    `);

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function ensureExtensionPairingSchema() {
  if (!schemaPromise) {
    schemaPromise = createSchema().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
