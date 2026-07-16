import { getPool } from '../../_db.js';
import { rateLimitByIp } from '../../_rate-limit-ip.js';
import { encryptToken } from '../../_crypto.js';
import { extensionCors } from '../../_extension-origin.js';
import { ensureSessionTransferSchema } from '../../_session-transfer-schema.js';
import { verifySessionTransferToken } from '../../_session-transfer-token.js';
import {
  hashPhone,
  payloadLimitBytes,
  validateCredsStructure,
} from '../../_session-transfer-utils.js';

export default async function handler(req, res) {
  if (process.env.WA_SESSION_TRANSFER_ENABLED !== 'true') {
    return res.status(404).json({ code: 'FEATURE_DISABLED' });
  }
  if (extensionCors(req, res, ['POST'])) return;
  if (await rateLimitByIp(req, res)) return;

  const auth = verifySessionTransferToken(req, 'session-transfer:upload');
  if (!auth) return res.status(401).json({ code: 'AUTHENTICATION_FAILED' });

  await ensureSessionTransferSchema();

  const transferRequestId = String(req.body?.transferRequestId || '');
  const credsJson = req.body?.credsJson;
  if (
    !transferRequestId ||
    transferRequestId !== auth.transfer_id ||
    typeof credsJson !== 'string' ||
    !credsJson
  ) {
    return res.status(400).json({ code: 'INVALID_UPLOAD_REQUEST' });
  }
  if (Buffer.byteLength(credsJson, 'utf8') > payloadLimitBytes()) {
    return res.status(413).json({ code: 'TRANSFER_PAYLOAD_TOO_LARGE' });
  }

  const structural = validateCredsStructure(credsJson);
  if (!structural.valid) {
    return res.status(422).json({
      code: 'INVALID_CREDS_STRUCTURE',
      reason: structural.reason,
    });
  }

  const pool = getPool();
  const found = await pool.query(
    `SELECT id, status, expires_at, token_jti, detected_phone_hash
     FROM wa_session_transfers WHERE id=$1 LIMIT 1`,
    [transferRequestId],
  );
  const transfer = found.rows[0];

  if (!transfer || transfer.token_jti !== auth.jti) {
    return res.status(404).json({ code: 'TRANSFER_NOT_FOUND' });
  }
  if (transfer.status !== 'EXCHANGED') {
    return res.status(409).json({ code: 'TRANSFER_NOT_IN_EXCHANGED_STATE' });
  }
  if (new Date(transfer.expires_at).getTime() <= Date.now()) {
    await pool.query(
      `UPDATE wa_session_transfers SET status='EXPIRED', updated_at=NOW() WHERE id=$1`,
      [transferRequestId],
    );
    return res.status(410).json({ code: 'TRANSFER_EXPIRED' });
  }

  const phoneHash = hashPhone(structural.detectedPhone);
  if (phoneHash !== transfer.detected_phone_hash) {
    return res.status(409).json({ code: 'PHONE_MISMATCH' });
  }

  await pool.query(
    `UPDATE wa_session_transfers
     SET session_payload_enc=$1, status='UPLOADED', updated_at=NOW()
     WHERE id=$2 AND status='EXCHANGED'`,
    [encryptToken(credsJson), transferRequestId],
  );

  return res.status(200).json({
    transferRequestId,
    status: 'UPLOADED',
  });
}
