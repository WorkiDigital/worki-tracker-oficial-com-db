// POST /api/browser-extension/session-transfer/import
// Única rota que escreve no PostgreSQL PRÓPRIO da Evolution (Instance/Session).
// Trava de segurança central: dentro da MESMA transação, nunca sobrescreve
// uma sessão de instância já conectada (connectionStatus='open'). Falha do
// pool da Evolution degrada para 503 limpo — nunca toca o pool principal.
import { verifyAuth } from '../../_auth.js';
import { cors } from '../../_cors.js';
import { getPool } from '../../_db.js';
import { getEvolutionPool } from '../../_evolution-db.js';
import { rateLimit } from '../../_rate-limit.js';
import { decryptToken } from '../../_crypto.js';
import { ensureSessionTransferSchema } from '../../_session-transfer-schema.js';

export default async function handler(req, res) {
  if (process.env.WA_SESSION_TRANSFER_ENABLED !== 'true') {
    return res.status(404).json({ code: 'FEATURE_DISABLED' });
  }

  if (cors(req, res, ['POST'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (!user.is_admin) return res.status(403).json({ code: 'ADMIN_ONLY' });
  if (await rateLimit(req, res, user)) return;

  await ensureSessionTransferSchema();

  const transferRequestId = String(req.body?.transferRequestId || '');
  if (!transferRequestId) return res.status(400).json({ code: 'INVALID_IMPORT_REQUEST' });

  const pool = getPool();
  const found = await pool.query(
    `SELECT id, instance_name, status, session_payload_enc, expires_at
     FROM wa_session_transfers WHERE id=$1 LIMIT 1`,
    [transferRequestId]
  );
  const transfer = found.rows[0];

  if (!transfer) return res.status(404).json({ code: 'TRANSFER_NOT_FOUND' });
  if (transfer.status !== 'UPLOADED') {
    return res.status(409).json({ code: 'TRANSFER_NOT_IN_UPLOADED_STATE' });
  }
  if (new Date(transfer.expires_at).getTime() <= Date.now()) {
    await pool.query(`UPDATE wa_session_transfers SET status='EXPIRED', updated_at=NOW() WHERE id=$1`, [transferRequestId]);
    return res.status(410).json({ code: 'TRANSFER_EXPIRED' });
  }

  const evoPool = getEvolutionPool();
  if (!evoPool) {
    return res.status(503).json({ code: 'EVOLUTION_DB_UNAVAILABLE' });
  }

  let credsJson;
  try {
    credsJson = decryptToken(transfer.session_payload_enc);
  } catch (error) {
    console.error('[session-transfer/import] falha ao descriptografar:', error.message);
    return res.status(500).json({ code: 'TRANSFER_DECRYPT_FAILED' });
  }

  await pool.query(`UPDATE wa_session_transfers SET status='IMPORTING', updated_at=NOW() WHERE id=$1`, [transferRequestId]);

  const evoClient = await evoPool.connect();
  try {
    await evoClient.query('BEGIN');

    const instanceRow = await evoClient.query(
      `SELECT id, "connectionStatus" FROM "Instance" WHERE name = $1 FOR UPDATE`,
      [transfer.instance_name]
    );
    if (!instanceRow.rows.length) {
      await evoClient.query('ROLLBACK');
      await pool.query(
        `UPDATE wa_session_transfers SET status='FAILED', last_error_code='EVOLUTION_INSTANCE_NOT_FOUND', updated_at=NOW() WHERE id=$1`,
        [transferRequestId]
      );
      return res.status(404).json({ code: 'EVOLUTION_INSTANCE_NOT_FOUND' });
    }

    const { id: instanceId, connectionStatus } = instanceRow.rows[0];

    // Rail de segurança central: nunca sobrescreve uma sessão já conectada,
    // verificado dentro da mesma transação com FOR UPDATE (sem race).
    if (String(connectionStatus || '').toLowerCase() === 'open') {
      await evoClient.query('ROLLBACK');
      await pool.query(
        `UPDATE wa_session_transfers SET status='FAILED', last_error_code='INSTANCE_ALREADY_CONNECTED', updated_at=NOW() WHERE id=$1`,
        [transferRequestId]
      );
      return res.status(409).json({ code: 'INSTANCE_ALREADY_CONNECTED' });
    }

    const existingSession = await evoClient.query(
      `SELECT id FROM "Session" WHERE "sessionId" = $1 FOR UPDATE`,
      [instanceId]
    );

    if (existingSession.rows.length) {
      await evoClient.query(
        `UPDATE "Session" SET creds = $1 WHERE "sessionId" = $2`,
        [credsJson, instanceId]
      );
    } else {
      await evoClient.query(
        `INSERT INTO "Session" (id, "sessionId", creds, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, NOW())`,
        [instanceId, credsJson]
      );
    }

    await evoClient.query('COMMIT');
  } catch (error) {
    try { await evoClient.query('ROLLBACK'); } catch {}
    console.error('[session-transfer/import] erro na transação Evolution:', error.message);
    await pool.query(
      `UPDATE wa_session_transfers SET status='FAILED', last_error_code='EVOLUTION_WRITE_FAILED', updated_at=NOW() WHERE id=$1`,
      [transferRequestId]
    );
    return res.status(502).json({ code: 'EVOLUTION_WRITE_FAILED' });
  } finally {
    evoClient.release();
  }

  await pool.query(
    `UPDATE wa_session_transfers SET status='IMPORTED', imported_at=NOW(), session_payload_enc=NULL, updated_at=NOW() WHERE id=$1`,
    [transferRequestId]
  );

  return res.status(200).json({ transferRequestId, status: 'IMPORTED' });
}
