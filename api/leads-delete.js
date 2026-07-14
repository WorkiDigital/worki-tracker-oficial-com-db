import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { requirePermission } from './_require-permission.js';

// Exclusão em lote de leads com isolamento multi-tenant.
// O frontend envia no máximo 500 IDs por chamada; o backend aceita até 1000.
export default async function handler(req, res) {
  if (cors(req, res, ['DELETE', 'POST'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (requirePermission(user, res, 'leads')) return;

  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(id => parseInt(id, 10))
    .filter(Number.isInteger))];

  if (!ids.length) return res.status(400).json({ error: 'Selecione pelo menos um lead.' });
  if (ids.length > 1000) return res.status(400).json({ error: 'Envie no máximo 1000 leads por operação.' });

  try {
    const pool = getPool();
    const params = [ids];
    let where = 'id = ANY($1::int[])';

    if (!user.is_admin) {
      params.push(user.cliente_id);
      where += ' AND cliente_id = $2';
    } else if (req.body?.cliente_id) {
      params.push(parseInt(req.body.cliente_id, 10));
      where += ' AND cliente_id = $2';
    }

    const result = await pool.query(
      `DELETE FROM leads_tracking WHERE ${where} RETURNING id, cliente_id`,
      params
    );

    return res.status(200).json({
      deleted: result.rowCount,
      ids: result.rows.map(row => row.id),
    });
  } catch (error) {
    console.error('[leads-delete]', error.message);
    return res.status(500).json({ error: 'Erro ao excluir leads.' });
  }
}
