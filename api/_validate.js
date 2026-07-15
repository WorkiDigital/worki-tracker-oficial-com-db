import { getPool } from './_db.js';

// Garante que a coluna account_id existe na tabela clientes
let _columnEnsured = false;
async function ensureAccountIdColumn() {
  if (_columnEnsured) return;
  try {
    await getPool().query(
      `ALTER TABLE clientes ADD COLUMN IF NOT EXISTS account_id VARCHAR(50)`
    );
    _columnEnsured = true;
  } catch (_) {
    _columnEnsured = true; // falha silenciosa (sem permissão de ALTER em prod vai ignorar)
  }
}

/**
 * Normaliza accountId: remove prefixo 'act_' para comparação uniforme.
 * Meta retorna ids como "act_123456" mas usuários às vezes passam só "123456".
 */
export const normalizeAccountId = id => String(id || '').replace(/^act_/, '').trim();

function parseClienteId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Verifica se o usuário tem acesso ao accountId informado.
 * - Admin: acesso irrestrito.
 * - Cliente sem account_id configurado: bloqueia por padrÃ£o.
 * - Cliente com account_id configurado: deve coincidir exatamente.
 * Retorna true/false.
 */
export async function verifyAccountAccess(user, accountId, scopedClienteId = null) {
  if (!accountId) return false;

  if (user.is_admin) {
    const hasScopedCliente = scopedClienteId !== null
      && scopedClienteId !== undefined
      && String(scopedClienteId).trim() !== '';
    const clienteId = parseClienteId(scopedClienteId);
    if (!hasScopedCliente) return true;
    if (!clienteId) return false;

    await ensureAccountIdColumn();
    try {
      const pool = getPool();
      const r = await pool.query(
        'SELECT account_id FROM clientes WHERE id = $1',
        [clienteId]
      );
      const configured = r.rows[0]?.account_id;
      return !!configured && normalizeAccountId(configured) === normalizeAccountId(accountId);
    } catch {
      return false;
    }
  }

  if (!user.cliente_id) return false;

  await ensureAccountIdColumn();

  try {
    const pool = getPool();
    const r = await pool.query(
      'SELECT account_id FROM clientes WHERE id = $1',
      [user.cliente_id]
    );
    const row = r.rows[0];
    if (!row) return false;
    // Sem account_id configurado: bloqueia, salvo flag legada explÃ­cita.
    if (!row.account_id) {
      return process.env.ALLOW_UNSCOPED_CLIENT_ACCOUNTS === 'true';
    }
    return normalizeAccountId(row.account_id) === normalizeAccountId(accountId);
  } catch {
    return false;
  }
}

/**
 * Retorna o account_id registrado para o cliente.
 * Para admin retorna null (sem restrição).
 */
export async function getClientAccountId(user) {
  if (user.is_admin) return null;
  if (!user.cliente_id) return null;

  await ensureAccountIdColumn();

  try {
    const pool = getPool();
    const r = await pool.query(
      'SELECT account_id FROM clientes WHERE id = $1',
      [user.cliente_id]
    );
    return r.rows[0]?.account_id || null;
  } catch {
    return null;
  }
}

export async function verifyAdAccountAccess(user, token, adId) {
  if (!adId || !/^\d+$/.test(String(adId))) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${adId}?fields=account_id&access_token=${token}`);
    const data = await r.json();
    if (data.error || !data.account_id) return false;
    return verifyAccountAccess(user, data.account_id);
  } catch {
    return false;
  }
}

export async function verifySharedAdAccount(metaToken, adId, accountId) {
  if (!adId || !accountId || !/^\d+$/.test(String(adId))) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${adId}?fields=account_id&access_token=${metaToken}`);
    const data = await r.json();
    if (data.error || !data.account_id) return false;
    return normalizeAccountId(data.account_id) === normalizeAccountId(accountId);
  } catch {
    return false;
  }
}

export async function verifySharedAdVideo(metaToken, adId, videoId, accountId) {
  if (!videoId || !/^\d+$/.test(String(videoId))) return false;
  if (!adId) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${adId}?fields=account_id,creative{video_id}&access_token=${metaToken}`);
    const data = await r.json();
    if (data.error || !data.account_id) return false;
    if (normalizeAccountId(data.account_id) !== normalizeAccountId(accountId)) return false;
    const creativeVideoId = data.creative?.video_id ? String(data.creative.video_id) : null;
    return creativeVideoId === String(videoId);
  } catch {
    return false;
  }
}
