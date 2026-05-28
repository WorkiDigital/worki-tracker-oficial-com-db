import { verifyAuth } from '../_auth.js';
import { getPool } from '../_db.js';
import { cors } from '../_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  res.setHeader('Cache-Control', 'private, max-age=5');

  const { limit = 50, offset = 0, instance, level, tag, search, date_from, date_to } = req.query;

  let where = 'WHERE 1=1';
  const params = [];
  let idx = 1;

  if (!user.is_admin) {
    where += ` AND cliente_id = $${idx++}`;
    params.push(user.cliente_id);
  } else if (req.query.cliente_id) {
    where += ` AND cliente_id = $${idx++}`;
    params.push(parseInt(req.query.cliente_id));
  }

  if (instance)  { where += ` AND instance ILIKE $${idx++}`;  params.push(`%${instance}%`); }
  if (level)     { where += ` AND level = $${idx++}`;          params.push(level); }
  if (tag)       { where += ` AND tag = $${idx++}`;            params.push(tag); }
  if (search)    { where += ` AND message ILIKE $${idx++}`;   params.push(`%${search}%`); }
  if (date_from) { where += ` AND created_at >= $${idx++}`;   params.push(date_from); }
  if (date_to)   { where += ` AND created_at < $${idx++}`;    params.push(date_to + ' 23:59:59'); }

  const limitVal  = Math.min(parseInt(limit) || 50, 200);
  const offsetVal = Math.max(parseInt(offset) || 0, 0);

  // Auto-prune silencioso: remove logs > 7 dias sem bloquear a resposta
  pool.query(`DELETE FROM webhook_logs WHERE created_at < NOW() - INTERVAL '7 days'`).catch(() => {});

  try {
    const [countResult, result] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM webhook_logs ${where}`, params),
      pool.query(
        `SELECT id, created_at, instance, level, tag, message, LEFT(data::text, 200) as data_preview 
         FROM webhook_logs ${where} ORDER BY id DESC LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limitVal, offsetVal]
      ),
    ]);

    return res.status(200).json({ logs: result.rows, total: countResult.rows[0].total });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
