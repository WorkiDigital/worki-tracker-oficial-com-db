// POST /api/browser-extension/session-transfer/create
// Cria um registro de transferência de sessão. Restrito a admin (is_admin) —
// mais rígido que pairing/create.js, que aceita qualquer usuário do tenant.
// Feature nova e sensível (grava credencial real de sessão) — só operadores
// internos confiáveis nesta fatia.
import { verifyAuth } from '../../_auth.js';
import { cors } from '../../_cors.js';
import { getPool } from '../../_db.js';
import { rateLimit } from '../../_rate-limit.js';
import { ensureSessionTransferSchema } from '../../_session-transfer-schema.js';
import { secondsFromEnv } from '../../_session-transfer-utils.js';

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

  const rawInstanceName = String(req.body?.instanceName || '').trim();
  const clienteId = Number(req.body?.target_cliente_id);

  if (!rawInstanceName || !Number.isInteger(clienteId) || clienteId <= 0) {
    return res.status(400).json({ code: 'INVALID_TRANSFER_REQUEST' });
  }

  const pool = getPool();

  // Mesmo padrão de reconstrução de prefixo/ownership de pairing/create.js —
  // nunca confia no prefixo isolado, sempre confirma na tabela de mapeamento.
  const prefix = `cliente_${clienteId}_`;
  const safeName = rawInstanceName.replace(/[^a-zA-Z0-9_-]/g, '');
  const candidateNames = Array.from(new Set([rawInstanceName, `${prefix}${safeName}`]));

  const ownership = await pool.query(
    `SELECT instance_name FROM instancias_mapeamento WHERE instance_name = ANY($1) AND cliente_id = $2 LIMIT 1`,
    [candidateNames, clienteId]
  );
  if (!ownership.rows.length) {
    return res.status(404).json({ code: 'INSTANCE_NOT_FOUND' });
  }
  const instanceName = ownership.rows[0].instance_name;

  // Rail de segurança mais importante desta fatia: mesmo com ownership válido,
  // a instância precisa estar na allowlist explícita. Vazia por padrão em
  // todo ambiente — inerte a menos que deliberadamente configurada.
  const allowlist = String(process.env.SESSION_TRANSFER_ALLOWED_INSTANCES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!allowlist.includes(instanceName)) {
    return res.status(403).json({ code: 'INSTANCE_NOT_ALLOWLISTED' });
  }

  const ttl = secondsFromEnv('EXTENSION_PLATFORM_CODE_TTL_SECONDS', 300, 60, 600);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE wa_session_transfers
       SET status='EXPIRED', session_payload_enc=NULL, updated_at=NOW()
       WHERE instance_name=$1 AND cliente_id=$2
         AND status IN ('CREATED','UPLOADED','IMPORTING')`,
      [instanceName, clienteId]
    );

    const inserted = await client.query(
      `INSERT INTO wa_session_transfers (created_by, cliente_id, instance_name, expires_at)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [user.id || null, clienteId, instanceName, expiresAt]
    );

    await client.query('COMMIT');

    return res.status(201).json({
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
