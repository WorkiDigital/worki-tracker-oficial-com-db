import { getPool } from '../../../_db.js';
import { rateLimitByIp } from '../../../_rate-limit-ip.js';
import { extensionCors } from '../../../_extension-origin.js';
import { rollbackSessionTransfer } from '../../../_session-transfer-rollback.js';
import { ensureSessionTransferSchema } from '../../../_session-transfer-schema.js';
import { verifySessionTransferToken } from '../../../_session-transfer-token.js';
import { fetchEvolutionJson } from '../../../_session-transfer-utils.js';

export default async function handler(req, res) {
  if (process.env.WA_SESSION_TRANSFER_ENABLED !== 'true') {
    return res.status(404).json({ code: 'FEATURE_DISABLED' });
  }
  if (extensionCors(req, res, ['GET'])) return;
  if (await rateLimitByIp(req, res)) return;

  const auth = verifySessionTransferToken(req, 'session-transfer:status');
  if (!auth) return res.status(401).json({ code: 'AUTHENTICATION_FAILED' });

  await ensureSessionTransferSchema();

  const transferRequestId = String(req.query?.id || '');
  if (!transferRequestId || transferRequestId !== auth.transfer_id) {
    return res.status(403).json({ code: 'TRANSFER_SCOPE_MISMATCH' });
  }

  const pool = getPool();
  const found = await pool.query(
    `SELECT * FROM wa_session_transfers WHERE id=$1 AND token_jti=$2 LIMIT 1`,
    [transferRequestId, auth.jti],
  );
  const transfer = found.rows[0];
  if (!transfer) return res.status(404).json({ code: 'TRANSFER_NOT_FOUND' });

  if (transfer.status === 'CONNECTED') {
    return res.status(200).json({ status: 'CONNECTED' });
  }
  if (transfer.status === 'FAILED') {
    return res.status(200).json({
      status: 'FAILED',
      errorCode: transfer.last_error_code,
    });
  }

  if (
    ['CREATED', 'EXCHANGED', 'UPLOADED'].includes(transfer.status) &&
    new Date(transfer.expires_at).getTime() <= Date.now()
  ) {
    await pool.query(
      `UPDATE wa_session_transfers
       SET status='EXPIRED', session_payload_enc=NULL, updated_at=NOW()
       WHERE id=$1`,
      [transfer.id],
    );
    return res.status(200).json({ status: 'EXPIRED' });
  }

  if (['IMPORTING', 'CONNECTING'].includes(transfer.status)) {
    try {
      const encoded = encodeURIComponent(transfer.instance_name);
      const stateData = await fetchEvolutionJson(
        `/instance/connectionState/${encoded}`,
      );
      const state = String(
        stateData?.instance?.state || stateData?.state || '',
      ).toLowerCase();

      if (['open', 'connected', 'online'].includes(state)) {
        await pool.query(
          `UPDATE wa_session_transfers
           SET status='CONNECTED', connected_at=NOW(),
               session_payload_enc=NULL, previous_session_creds_enc=NULL,
               updated_at=NOW()
           WHERE id=$1`,
          [transfer.id],
        );
        return res.status(200).json({ status: 'CONNECTED' });
      }
    } catch (error) {
      console.error('[session-transfer/status] consulta Evolution:', error.message);
    }

    if (
      transfer.connection_deadline_at &&
      new Date(transfer.connection_deadline_at).getTime() <= Date.now()
    ) {
      await rollbackSessionTransfer(transfer, 'EVOLUTION_CONNECTION_TIMEOUT');
      return res.status(200).json({
        status: 'FAILED',
        errorCode: 'EVOLUTION_CONNECTION_TIMEOUT',
      });
    }

    return res.status(200).json({ status: 'CONNECTING' });
  }

  return res.status(200).json({ status: transfer.status });
}
