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
const normalize = id => String(id || '').replace(/^act_/, '').trim();

/**
 * Verifica se o usuário tem acesso ao accountId informado.
 * - Admin: acesso irrestrito.
 * - Cliente sem account_id configurado: permite (retrocompatibilidade).
 * - Cliente com account_id configurado: deve coincidir exatamente.
 * Retorna true/false.
 */
export async function verifyAccountAccess(user, accountId) {
  if (!accountId) return false;
  if (user.is_admin) return true;
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
    // Sem account_id configurado: permite (admin ainda não vinculou)
    if (!row.account_id) return true;
    return normalize(row.account_id) === normalize(accountId);
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
