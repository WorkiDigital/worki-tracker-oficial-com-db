// POST /api/browser-extension/pairing/create
// Gera o código temporário no painel (autenticado com JWT normal) — o único
// ponto do fluxo onde o código é criado. A extensão nunca gera código, só
// recebe o que o usuário colar (ver exchange.js).
import { verifyAuth } from '../../_auth.js';
import { cors } from '../../_cors.js';
import { getPool } from '../../_db.js';
import { rateLimit } from '../../_rate-limit.js';
import { ensureExtensionPairingSchema } from '../../_extension-pairing-schema.js';
import {
  createPlatformCode,
  hashPlatformCode,
  normalizePhone,
  secondsFromEnv,
} from '../../_extension-pairing-utils.js';

export default async function handler(req, res) {
  if (cors(req, res, ['POST'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  await ensureExtensionPairingSchema();

  const rawInstanceName = String(req.body?.instanceName || '').trim();
  // Opcional: a extensão detecta o telefone (wid/me) após o login no WhatsApp
  // Web e envia em /exchange; se não conseguir, cai no fallback manual do
  // /start. Se o painel já quiser fixar um número de antemão, ainda aceita.
  const rawPhone = String(req.body?.phoneNumber || '').trim();
  const expectedPhone = rawPhone ? normalizePhone(rawPhone) : null;
  const clienteId = user.is_admin
    ? Number(req.body?.target_cliente_id)
    : Number(user.cliente_id);

  if (!rawInstanceName || (rawPhone && !expectedPhone) || !Number.isInteger(clienteId) || clienteId <= 0) {
    return res.status(400).json({ code: 'INVALID_PAIRING_REQUEST' });
  }

  const pool = getPool();

  // O painel manda o nome "curto" (sem o prefixo cliente_N_/admin_ — ver
  // renderWaLista/displayName em js/admin.js), mesmo padrão que
  // api/evo-manager.js reconstrói antes de falar com a Evolution. Aceita as
  // duas formas (curta ou já prefixada) para não quebrar chamadas antigas.
  const prefix = user.is_admin ? `cliente_${clienteId}_` : `cliente_${user.cliente_id}_`;
  const safeName = rawInstanceName.replace(/[^a-zA-Z0-9_-]/g, '');
  const candidateNames = Array.from(new Set([rawInstanceName, `${prefix}${safeName}`]));

  // Nunca deriva o tenant apenas pelo prefixo do nome da instância — sempre
  // confirma o vínculo real na tabela de mapeamento (mesmo padrão de
  // isolamento multi-tenant já usado em api/evo-manager.js).
  const ownership = await pool.query(
    `SELECT instance_name FROM instancias_mapeamento WHERE instance_name = ANY($1) AND cliente_id = $2 LIMIT 1`,
    [candidateNames, clienteId]
  );
  if (!ownership.rows.length) {
    return res.status(404).json({ code: 'INSTANCE_NOT_FOUND' });
  }
  const instanceName = ownership.rows[0].instance_name;

  const { raw, display } = createPlatformCode();
  const codeHash = hashPlatformCode(raw);
  const ttl = secondsFromEnv('EXTENSION_PLATFORM_CODE_TTL_SECONDS', 300, 60, 600);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Invalida operações antigas ainda abertas para a mesma instância — evita
    // ter 2 códigos válidos concorrentes para a mesma conexão.
    await client.query(
      `UPDATE wa_extension_pairings
       SET status='EXPIRED', pairing_code_enc=NULL, updated_at=NOW()
       WHERE instance_name=$1 AND cliente_id=$2
         AND status IN ('CREATED','EXCHANGED','WAITING','CONNECTING')`,
      [instanceName, clienteId]
    );

    const inserted = await client.query(
      `INSERT INTO wa_extension_pairings (code_hash, created_by, cliente_id, instance_name, expected_phone, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [codeHash, user.id || null, clienteId, instanceName, expectedPhone, expiresAt]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      code: display,
      pairingRequestId: inserted.rows[0].id,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[pairing/create] erro:', error.message);
    return res.status(500).json({ code: 'PAIRING_CREATE_FAILED' });
  } finally {
    client.release();
  }
}
