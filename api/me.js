// Retorna as permissões atuais do usuário logado direto do banco.
// Chamado no init() do dashboard para garantir que mudanças de permissão
// feitas pelo admin sejam refletidas sem forçar logout/login.
import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  // Admin do .env (id 0) ou admin do banco: permissões totais, sem consulta ao banco de clientes.
  if (user.is_admin) {
    return res.status(200).json({ permissoes: user.permissoes || {} });
  }

  try {
    const pool = getPool();
    const r = await pool.query('SELECT permissoes FROM clientes WHERE id = $1', [user.cliente_id]);
    const permissoes = r.rows[0]?.permissoes || user.permissoes || {};
    return res.status(200).json({ permissoes });
  } catch (e) {
    // Em caso de falha, devolve as permissões do JWT sem derrubar o dashboard.
    return res.status(200).json({ permissoes: user.permissoes || {} });
  }
}
