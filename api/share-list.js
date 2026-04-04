import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  try {
    const result = await pool.query(
      `SELECT token, account_id, account_name, client_name, visible_sections, visible_metrics, visible_columns, status_filter, expires_at, created_at 
       FROM share_tokens 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [user.id]
    );

    return res.status(200).json({ tokens: result.rows || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar links de compartilhamento' });
  }
}
