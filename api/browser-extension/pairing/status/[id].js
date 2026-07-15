// GET /api/browser-extension/pairing/status/:id
// Bearer JWT de extensão. Consulta o status da operação, cruzando com
// instancias_mapeamento.connection_state (populada pelo webhook quando a
// Evolution manda connection.update). server.js já injeta req.query.id a
// partir do segmento dinâmico — mesmo mecanismo usado por outras rotas
// [id].js do projeto, sem limite de profundidade de diretório.
import { getPool } from '../../../_db.js';
import { extensionCors } from '../../../_extension-origin.js';
import { ensureExtensionPairingSchema } from '../../../_extension-pairing-schema.js';
import { verifyExtensionToken } from '../../../_extension-token.js';

function publicStatus(row) {
  const state = String(row.connection_state || '').toLowerCase();
  if (['open', 'connected', 'online'].includes(state)) return 'CONNECTED';
  if (state === 'connecting') return 'CONNECTING';
  return row.status;
}

export default async function handler(req, res) {
  if (extensionCors(req, res, ['GET'])) return;

  const auth = verifyExtensionToken(req, 'pairing:status');
  if (!auth) return res.status(401).json({ code: 'AUTHENTICATION_FAILED' });

  await ensureExtensionPairingSchema();

  const operationId = String(req.query?.id || '');
  if (!operationId || operationId !== auth.pairing_id) {
    return res.status(403).json({ code: 'PAIRING_SCOPE_MISMATCH' });
  }

  const pool = getPool();
  const found = await pool.query(
    `SELECT p.*, m.connection_state
     FROM wa_extension_pairings p
     LEFT JOIN instancias_mapeamento m ON m.instance_name=p.instance_name AND m.cliente_id=p.cliente_id
     WHERE p.id=$1 AND p.token_jti=$2 LIMIT 1`,
    [operationId, auth.jti]
  );
  const row = found.rows[0];
  if (!row) return res.status(404).json({ code: 'PAIRING_NOT_FOUND' });

  let status = publicStatus(row);
  if (
    !['CONNECTED', 'FAILED', 'EXPIRED'].includes(status) &&
    row.pairing_expires_at &&
    new Date(row.pairing_expires_at).getTime() <= Date.now()
  ) {
    status = 'EXPIRED';
  }

  if (status !== row.status) {
    await pool.query(
      `UPDATE wa_extension_pairings
       SET status=$1,
           connected_at = CASE WHEN $1='CONNECTED' THEN NOW() ELSE connected_at END,
           pairing_code_enc = CASE WHEN $1 IN ('CONNECTED','FAILED','EXPIRED') THEN NULL ELSE pairing_code_enc END,
           updated_at=NOW()
       WHERE id=$2`,
      [status, row.id]
    );
  }

  return res.status(200).json({
    status,
    instanceId: row.instance_name,
    phoneNumber: row.expected_phone,
  });
}
