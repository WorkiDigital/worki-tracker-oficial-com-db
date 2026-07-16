import { getPool } from '../../_db.js';
import { rateLimitByIp } from '../../_rate-limit-ip.js';
import { extensionCors } from '../../_extension-origin.js';
import { ensureSessionTransferSchema } from '../../_session-transfer-schema.js';
import {
  hashPhone,
  hashPlatformCode,
  normalizePhone,
  normalizePlatformCode,
} from '../../_session-transfer-utils.js';
import { issueSessionTransferToken } from '../../_session-transfer-token.js';

export default async function handler(req, res) {
  if (process.env.WA_SESSION_TRANSFER_ENABLED !== 'true') {
    return res.status(404).json({ code: 'FEATURE_DISABLED' });
  }
  if (extensionCors(req, res, ['POST'])) return;
  if (await rateLimitByIp(req, res)) return;

  await ensureSessionTransferSchema();

  const normalizedCode = normalizePlatformCode(req.body?.code);
  const whatsapp = req.body?.whatsapp || req.body?.whatsappWeb || {};
  const loggedIn = whatsapp.status === 'LOGGED_IN' || whatsapp.loggedIn === true;
  const detectedPhone = normalizePhone(String(whatsapp.detectedPhone || ''));

  if (!normalizedCode) return res.status(400).json({ code: 'TRANSFER_CODE_INVALID' });
  if (!loggedIn) return res.status(409).json({ code: 'WHATSAPP_NOT_LOGGED_IN' });
  if (!detectedPhone) return res.status(422).json({ code: 'PHONE_NOT_DETECTED' });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM wa_session_transfers WHERE code_hash=$1 FOR UPDATE`,
      [hashPlatformCode(normalizedCode)],
    );
    const transfer = found.rows[0];

    if (!transfer) {
      await client.query('ROLLBACK');
      return res.status(400).json({ code: 'TRANSFER_CODE_INVALID' });
    }
    if (transfer.status !== 'CREATED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'TRANSFER_CODE_USED' });
    }
    if (new Date(transfer.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE wa_session_transfers SET status='EXPIRED', code_hash=NULL, updated_at=NOW() WHERE id=$1`,
        [transfer.id],
      );
      await client.query('COMMIT');
      return res.status(410).json({ code: 'TRANSFER_CODE_EXPIRED' });
    }

    const issued = issueSessionTransferToken(transfer);
    await client.query(
      `UPDATE wa_session_transfers
       SET status='EXCHANGED', token_jti=$1, detected_phone_hash=$2,
           claimed_at=NOW(), code_hash=NULL, updated_at=NOW()
       WHERE id=$3`,
      [issued.jti, hashPhone(detectedPhone), transfer.id],
    );
    await client.query('COMMIT');

    return res.status(200).json({
      accessToken: issued.token,
      transferRequestId: transfer.id,
      expiresInSeconds: issued.expiresIn,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[session-transfer/exchange] erro:', error.message);
    return res.status(500).json({ code: 'TRANSFER_EXCHANGE_FAILED' });
  } finally {
    client.release();
  }
}
