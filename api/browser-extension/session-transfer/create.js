import { verifyAuth } from '../../_auth.js';
import { cors } from '../../_cors.js';
import { getPool } from '../../_db.js';
import { rateLimit } from '../../_rate-limit.js';
import { ensureSessionTransferSchema } from '../../_session-transfer-schema.js';
import {
  createPlatformCode,
  hashPlatformCode,
  secondsFromEnv,
} from '../../_session-transfer-utils.js';

export default async function handler(req, res) {
  if (process.env.WA_SESSION_TRANSFER_ENABLED !== 'true') {
    return res.status(404).json({ code: 'FEATURE_DISABLED' });
  }
  if (cors(req, res, ['POST'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  await ensureSessionTransferSchema();

  const rawInstanceName = String(req.body?.instanceName || '').trim();
  const clienteId = user.is_admin
    ? Number(req.body?.target_cliente_id)
    : Number(user.cliente_id);

  if (!rawInstanceName || !Number.isInteger(clienteId) || clienteId <= 0) {
    return res.status(400).json({ code: 'INVALID_TRANSFER_REQUEST' });
  }

  const pool = getPool();
  const prefix = `cliente_${clienteId}_`;
  const safeName = rawInstanceName.replace(/[^a-zA-Z0-9_-]/g, '');
  const candidateNames = Array.from(new Set([rawInstanceName, `${prefix}${safeName}`]));

  const ownership = await pool.query(
    `SELECT instance_name FROM instancias_mapeamento
     WHERE instance_name=ANY($1) AND cliente_id=$2 LIMIT 1`,
    [candidateNames, clienteId],
  );
  if (!ownership.rows.length) {
    return res.status(404).json({ code: 'INSTANCE_NOT_FOUND' });
  }
  const instanceName = ownership.rows[0].instance_name;

  const allowlist = String(process.env.SESSION_TRANSFER_ALLOWED_INSTANCES || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!allowlist.includes('*') && !allowlist.includes(instanceName)) {
    return res.status(403).json({ code: 'INSTANCE_NOT_ALLOWLISTED' });
  }

  const { raw, display } = createPlatformCode();
  const codeHash = hashPlatformCode(raw);
  const ttl = secondsFromEnv('EXTENSION_PLATFORM_CODE_TTL_SECONDS', 300, 60, 600);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE wa_session_transfers
       SET status='EXPIRED', session_payload_enc=NULL,
           previous_session_creds_enc=NULL, updated_at=NOW()
       WHERE instance_name=$1 AND cliente_id=$2
         AND status IN ('CREATED','EXCHANGED','UPLOADED','IMPORTING','CONNECTING')`,
      [instanceName, clienteId],
    );

    const inserted = await client.query(
      `INSERT INTO wa_session_transfers
       (code_hash, created_by, cliente_id, instance_name, expires_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [codeHash, user.id || null, clienteId, instanceName, expiresAt],
    );
    await client.query('COMMIT');

    return res.status(201).json({
      code: display,
      transferRequestId: inserted.rows[0].id,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[session-transfer/create] erro:', error.message);
    return res.status(500).json({ code: 'TRANSFER_CREATE_FAILED' });
  } finally {
    client.release();
  }
}
