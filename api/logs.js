import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.webhook_logs (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      instance VARCHAR(255),
      cliente_id INTEGER,
      level VARCHAR(10) DEFAULT 'info',
      tag VARCHAR(50),
      message TEXT,
      data JSONB
    )
  `);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  await ensureTable(pool);

  const { limit = 300, instance, level, tag, date_from, date_to } = req.query;

  let query = 'SELECT * FROM webhook_logs WHERE 1=1';
  const params = [];
  let idx = 1;

  if (!user.is_admin) {
    query += ` AND cliente_id = $${idx++}`;
    params.push(user.cliente_id);
  }

  if (instance)  { query += ` AND instance ILIKE $${idx++}`;  params.push(`%${instance}%`); }
  if (level)     { query += ` AND level = $${idx++}`;          params.push(level); }
  if (tag)       { query += ` AND tag = $${idx++}`;            params.push(tag); }
  if (date_from) { query += ` AND created_at >= $${idx++}`;   params.push(date_from); }
  if (date_to)   { query += ` AND created_at < $${idx++}`;    params.push(date_to + ' 23:59:59'); }

  query += ` ORDER BY id DESC LIMIT $${idx}`;
  params.push(Math.min(parseInt(limit) || 300, 500));

  try {
    const result = await pool.query(query, params);
    return res.status(200).json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
