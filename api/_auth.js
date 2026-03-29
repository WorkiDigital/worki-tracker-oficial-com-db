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
 */
export async function getTokenForUser(user) {
    if (!user || !user.cliente_id) {
        return user?.is_admin ? process.env.META_ADS_TOKEN : null;
    }
    try {
        const pool = getPool();
        const res = await pool.query('SELECT token_meta FROM clientes WHERE id = $1', [user.cliente_id]);
        if (res.rows.length > 0 && res.rows[0].token_meta) {
            return res.rows[0].token_meta;
        }
    } catch(e) { }
    // Fallback master para admins (se o DB falhar ou não tiver token lá)
    return user.is_admin ? process.env.META_ADS_TOKEN : null;
}
