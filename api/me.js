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
    const r = await pool.query(`
      SELECT 
        permissoes, 
        pixel_padrao, 
        google_ads_conversion_id, 
        google_ads_conversion_label, 
        capi_pixel_id, 
        token_last4, 
        capi_token_last4 
      FROM clientes WHERE id = $1
    `, [user.cliente_id]);
    
    if (r.rows.length === 0) {
        return res.status(200).json({ permissoes: user.permissoes || {} });
    }

    const row = r.rows[0];
    const permissoes = row.permissoes || user.permissoes || {};
    const integracoes = {
        pixel_padrao: row.pixel_padrao,
        google_ads_conversion_id: row.google_ads_conversion_id,
        google_ads_conversion_label: row.google_ads_conversion_label,
        capi_pixel_id: row.capi_pixel_id,
        token_last4: row.token_last4,
        capi_token_last4: row.capi_token_last4
    };

    return res.status(200).json({ permissoes, integracoes });
  } catch (e) {
    // Em caso de falha, devolve as permissões do JWT sem derrubar o dashboard.
    return res.status(200).json({ permissoes: user.permissoes || {} });
  }
}
