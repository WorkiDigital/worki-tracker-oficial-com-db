import jwt from 'jsonwebtoken';
import { getPool } from './_db.js';

/**
 * Verifica o JWT do usuário via Authorization header.
 * Retorna o objeto user ou null (já respondendo 401 se inválido).
 */
export async function verifyAuth(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) {
    res.status(401).json({ error: 'Não autenticado' });
    return null;
  }

  try {
    const secret = process.env.JWT_SECRET || 'SECRET_LOCAL_DEV';
    const decoded = jwt.verify(token, secret);
    return decoded; // { id, email, iat, exp, is_admin, cliente_id }
  } catch (error) {
    res.status(401).json({ error: 'Sessão inválida ou expirada' });
    return null;
  }
}

/**
 * Retorna o token de Meta Ads seguro para o escopo do usuário atual.
 * Admin: usa token da agência (variável de ambiente).
 * Cliente: SOMENTE o token_meta próprio do cliente no banco. Sem fallback.
 */
export async function getTokenForUser(user) {
    if (!user) return null;
    // Admin da plataforma usa o token da agência
    if (user.is_admin) return process.env.META_ADS_TOKEN || null;
    // Cliente DEVE ter cliente_id e token próprio no banco
    if (!user.cliente_id) return null;
    try {
        const pool = getPool();
        const res = await pool.query('SELECT token_meta FROM clientes WHERE id = $1', [user.cliente_id]);
        if (res.rows.length > 0 && res.rows[0].token_meta) {
            return res.rows[0].token_meta;
        }
    } catch(e) {
        console.error('[auth] Erro ao buscar token do cliente:', e.message);
    }
    return null; // Nunca usa token da agência para usuários clientes
}
