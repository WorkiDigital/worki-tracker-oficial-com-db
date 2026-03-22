import { createClient } from '@supabase/supabase-js';

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

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Sessão inválida ou expirada' });
    return null;
  }

  return data.user;
}
