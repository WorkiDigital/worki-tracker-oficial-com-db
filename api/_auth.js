import jwt from 'jsonwebtoken';
import { getPool } from './_db.js';

// Alerta crítico em produção se JWT_SECRET não estiver configurado
if (!process.env.JWT_SECRET) {
  console.error('[SECURITY] CRÍTICO: JWT_SECRET não definido. Qualquer pessoa pode forjar tokens de admin. Configure a variável de ambiente imediatamente.');
}

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
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const decoded = jwt.verify(token, secret);
    return decoded; // { id, email, iat, exp, is_admin, cliente_id }
  } catch (error) {
    res.status(401).json({ error: 'Sessão inválida ou expirada' });
    return null;
  }
}

/**
 * Retorna o token de Meta Ads seguro para o escopo do usuário atual.
 * Agência tem token global com acesso a todos os pixels dos clientes.
 * Todos os usuários (admin e clientes) usam o META_ADS_TOKEN da env.
 */
export async function getTokenForUser(user) {
    if (!user) return null;
    if (user.is_admin || !user.cliente_id) {
        return process.env.META_ADS_TOKEN || null;
    }

    try {
        const r = await getPool().query(
            'SELECT token_meta FROM clientes WHERE id = $1',
            [user.cliente_id]
        );
        return r.rows[0]?.token_meta || process.env.META_ADS_TOKEN || null;
    } catch {
        return process.env.META_ADS_TOKEN || null;
    }
}
