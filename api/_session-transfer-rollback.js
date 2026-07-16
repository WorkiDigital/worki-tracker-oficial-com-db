import { decryptToken } from './_crypto.js';
import { getPool } from './_db.js';
import { getEvolutionPool } from './_evolution-db.js';

export async function rollbackSessionTransfer(transfer, errorCode) {
  const pool = getPool();
  const evoPool = getEvolutionPool();

  if (!evoPool) {
    await pool.query(
      `UPDATE wa_session_transfers
       SET status='FAILED', last_error_code=$1, session_payload_enc=NULL,
           previous_session_creds_enc=NULL, updated_at=NOW()
       WHERE id=$2`,
      [errorCode, transfer.id],
    );
    return;
  }

  const evoClient = await evoPool.connect();
  try {
    await evoClient.query('BEGIN');
    const instance = await evoClient.query(
      `SELECT id FROM "Instance" WHERE name=$1 FOR UPDATE`,
      [transfer.instance_name],
    );

    if (instance.rows.length) {
      const instanceId = instance.rows[0].id;
      if (transfer.previous_session_existed && transfer.previous_session_creds_enc) {
        const previousCreds = decryptToken(transfer.previous_session_creds_enc);
        await evoClient.query(
          `INSERT INTO "Session" (id, "sessionId", creds, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, NOW())
           ON CONFLICT ("sessionId") DO UPDATE SET creds=EXCLUDED.creds`,
          [instanceId, previousCreds],
        );
      } else {
        await evoClient.query(`DELETE FROM "Session" WHERE "sessionId"=$1`, [instanceId]);
      }
    }

    await evoClient.query('COMMIT');
  } catch (error) {
    try { await evoClient.query('ROLLBACK'); } catch {}
    console.error('[session-transfer/rollback] falha:', error.message);
    errorCode = 'ROLLBACK_FAILED';
  } finally {
    evoClient.release();
  }

  await pool.query(
    `UPDATE wa_session_transfers
     SET status='FAILED', last_error_code=$1, session_payload_enc=NULL,
         previous_session_creds_enc=NULL, updated_at=NOW()
     WHERE id=$2`,
    [errorCode, transfer.id],
  );
}
