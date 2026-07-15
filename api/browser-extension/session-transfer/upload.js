// POST /api/browser-extension/session-transfer/upload
// Recebe o credsJson (string duplamente serializada, formato exato do
// Session.creds da Evolution), valida estrutura, criptografa e guarda —
// nunca em texto puro, mesmo padrão de pairing_code_enc via api/_crypto.js.
import { verifyAuth } from '../../_auth.js';
import { cors } from '../../_cors.js';
import { getPool } from '../../_db.js';
import { rateLimit } from '../../_rate-limit.js';
import { encryptToken } from '../../_crypto.js';
import { ensureSessionTransferSchema } from '../../_session-transfer-schema.js';
import { validateCredsStructure, hashPhone } from '../../_session-transfer-utils.js';

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
  const credsJson = req.body?.credsJson;
  const detectedPhone = req.body?.detectedPhone ? String(req.body.detectedPhone) : null;

  if (!transferRequestId || typeof credsJson !== 'string' || !credsJson) {
    return res.status(400).json({ code: 'INVALID_UPLOAD_REQUEST' });
  }

  const structural = validateCredsStructure(credsJson);
  if (!structural.valid) {
    return res.status(422).json({ code: 'INVALID_CREDS_STRUCTURE', reason: structural.reason });
  }

  const pool = getPool();
  const found = await pool.query(
    `SELECT id, cliente_id, status, expires_at FROM wa_session_transfers WHERE id=$1 LIMIT 1`,
    [transferRequestId]
  );
  const transfer = found.rows[0];

  if (!transfer) return res.status(404).json({ code: 'TRANSFER_NOT_FOUND' });
  if (transfer.status !== 'CREATED') {
    return res.status(409).json({ code: 'TRANSFER_NOT_IN_CREATED_STATE' });
  }
  if (new Date(transfer.expires_at).getTime() <= Date.now()) {
    await pool.query(`UPDATE wa_session_transfers SET status='EXPIRED', updated_at=NOW() WHERE id=$1`, [transferRequestId]);
    return res.status(410).json({ code: 'TRANSFER_EXPIRED' });
  }

  const encrypted = encryptToken(credsJson);
  const phoneHash = detectedPhone ? hashPhone(detectedPhone) : null;

  await pool.query(
    `UPDATE wa_session_transfers
     SET session_payload_enc=$1, detected_phone_hash=$2, status='UPLOADED', updated_at=NOW()
     WHERE id=$3`,
    [encrypted, phoneHash, transferRequestId]
  );

  return res.status(200).json({ transferRequestId, status: 'UPLOADED' });
}
