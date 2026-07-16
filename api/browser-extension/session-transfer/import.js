import { encryptToken, decryptToken } from '../../_crypto.js';
import { getPool } from '../../_db.js';
import { getEvolutionPool } from '../../_evolution-db.js';
import { rateLimitByIp } from '../../_rate-limit-ip.js';
import { extensionCors } from '../../_extension-origin.js';
import { rollbackSessionTransfer } from '../../_session-transfer-rollback.js';
import { ensureSessionTransferSchema } from '../../_session-transfer-schema.js';
import { verifySessionTransferToken } from '../../_session-transfer-token.js';
import {
  fetchEvolutionJson,
  secondsFromEnv,
} from '../../_session-transfer-utils.js';

export default async function handler(req, res) {
  if (process.env.WA_SESSION_TRANSFER_ENABLED !== 'true') {
    return res.status(404).json({ code: 'FEATURE_DISABLED' });
  }
  if (extensionCors(req, res, ['POST'])) return;
  if (await rateLimitByIp(req, res)) return;

  const auth = verifySessionTransferToken(req, 'session-transfer:import');
  if (!auth) return res.status(401).json({ code: 'AUTHENTICATION_FAILED' });

  await ensureSessionTransferSchema();

  const transferRequestId = String(req.body?.transferRequestId || '');
  if (!transferRequestId || transferRequestId !== auth.transfer_id) {
    return res.status(400).json({ code: 'INVALID_IMPORT_REQUEST' });
  }

  const pool = getPool();
  const found = await pool.query(
    `SELECT * FROM wa_session_transfers WHERE id=$1 LIMIT 1`,
    [transferRequestId],
  );
  const transfer = found.rows[0];

  if (!transfer || transfer.token_jti !== auth.jti) {
    return res.status(404).json({ code: 'TRANSFER_NOT_FOUND' });
  }
  if (transfer.status !== 'UPLOADED') {
    return res.status(409).json({ code: 'TRANSFER_NOT_IN_UPLOADED_STATE' });
  }
  if (new Date(transfer.expires_at).getTime() <= Date.now()) {
    await pool.query(
      `UPDATE wa_session_transfers
       SET status='EXPIRED', session_payload_enc=NULL, updated_at=NOW()
       WHERE id=$1`,
      [transferRequestId],
    );
    return res.status(410).json({ code: 'TRANSFER_EXPIRED' });
  }

  const evoPool = getEvolutionPool();
  if (!evoPool) return res.status(503).json({ code: 'EVOLUTION_DB_UNAVAILABLE' });

  let credsJson;
  try {
    credsJson = decryptToken(transfer.session_payload_enc);
  } catch (error) {
    console.error('[session-transfer/import] falha ao descriptografar:', error.message);
    return res.status(500).json({ code: 'TRANSFER_DECRYPT_FAILED' });
  }

  await pool.query(
    `UPDATE wa_session_transfers
     SET status='IMPORTING', attempts=attempts+1, updated_at=NOW()
     WHERE id=$1 AND status='UPLOADED'`,
    [transferRequestId],
  );

  const evoClient = await evoPool.connect();
  try {
    await evoClient.query('BEGIN');
    const instanceRow = await evoClient.query(
      `SELECT id, "connectionStatus" FROM "Instance" WHERE name=$1 FOR UPDATE`,
      [transfer.instance_name],
    );
    if (!instanceRow.rows.length) {
      await evoClient.query('ROLLBACK');
      await rollbackSessionTransfer(transfer, 'EVOLUTION_INSTANCE_NOT_FOUND');
      return res.status(404).json({ code: 'EVOLUTION_INSTANCE_NOT_FOUND' });
    }

    const { id: instanceId, connectionStatus } = instanceRow.rows[0];
    if (String(connectionStatus || '').toLowerCase() === 'open') {
      await evoClient.query('ROLLBACK');
      await rollbackSessionTransfer(transfer, 'INSTANCE_ALREADY_CONNECTED');
      return res.status(409).json({ code: 'INSTANCE_ALREADY_CONNECTED' });
    }

    const existing = await evoClient.query(
      `SELECT id, creds FROM "Session" WHERE "sessionId"=$1 FOR UPDATE`,
      [instanceId],
    );
    const previousExisted = existing.rows.length > 0;
    const previousRaw = previousExisted
      ? (typeof existing.rows[0].creds === 'string'
          ? existing.rows[0].creds
          : JSON.stringify(existing.rows[0].creds))
      : null;
    const previousEncrypted = previousRaw ? encryptToken(previousRaw) : null;

    transfer.previous_session_existed = previousExisted;
    transfer.previous_session_creds_enc = previousEncrypted;
    await pool.query(
      `UPDATE wa_session_transfers
       SET previous_session_existed=$1, previous_session_creds_enc=$2, updated_at=NOW()
       WHERE id=$3`,
      [previousExisted, previousEncrypted, transferRequestId],
    );

    if (previousExisted) {
      await evoClient.query(
        `UPDATE "Session" SET creds=$1 WHERE "sessionId"=$2`,
        [credsJson, instanceId],
      );
    } else {
      await evoClient.query(
        `INSERT INTO "Session" (id, "sessionId", creds, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, NOW())`,
        [instanceId, credsJson],
      );
    }
    await evoClient.query('COMMIT');
  } catch (error) {
    try { await evoClient.query('ROLLBACK'); } catch {}
    console.error('[session-transfer/import] erro na transação Evolution:', error.message);
    await rollbackSessionTransfer(transfer, 'EVOLUTION_WRITE_FAILED');
    return res.status(502).json({ code: 'EVOLUTION_WRITE_FAILED' });
  } finally {
    evoClient.release();
  }

  try {
    const encoded = encodeURIComponent(transfer.instance_name);
    const connectResponse = await fetchEvolutionJson(`/instance/connect/${encoded}`);
    if (connectResponse?.error === true) {
      throw new Error('EVOLUTION_CONNECT_REJECTED');
    }
  } catch (error) {
    console.error('[session-transfer/import] falha ao recarregar instância:', error.message);
    await rollbackSessionTransfer(transfer, 'EVOLUTION_CONNECT_FAILED');
    return res.status(502).json({ code: 'EVOLUTION_CONNECT_FAILED' });
  }

  const deadlineSeconds = secondsFromEnv(
    'SESSION_TRANSFER_CONNECTION_TIMEOUT_SECONDS',
    90,
    30,
    180,
  );
  const deadline = new Date(Date.now() + deadlineSeconds * 1000);
  await pool.query(
    `UPDATE wa_session_transfers
     SET status='CONNECTING', imported_at=NOW(), connection_deadline_at=$1,
         last_error_code=NULL, updated_at=NOW()
     WHERE id=$2`,
    [deadline, transferRequestId],
  );

  return res.status(202).json({
    transferRequestId,
    status: 'CONNECTING',
    connectionDeadlineAt: deadline.toISOString(),
  });
}
