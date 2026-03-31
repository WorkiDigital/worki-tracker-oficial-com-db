import { verifyAuth } from '../api/_auth.js';
import { getPool } from '../api/_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  let body = '';
  await new Promise(r => { req.on('data', d => body += d); req.on('end', r); });

  let parsed;
  try { parsed = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'Body JSON inválido' }); }
  const { token, client_name, visible_sections, visible_metrics, visible_columns, status_filter, expires_at } = parsed;

  if (!token) return res.status(400).json({ error: 'token required' });

  const pool = getPool();
  
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (client_name !== undefined) { updates.push(`client_name = $${paramCount++}`); values.push(client_name); }
  if (visible_sections !== undefined) { updates.push(`visible_sections = $${paramCount++}`); values.push(JSON.stringify(visible_sections)); }
  if (visible_metrics !== undefined) { updates.push(`visible_metrics = $${paramCount++}`); values.push(JSON.stringify(visible_metrics)); }
  if (visible_columns !== undefined) { updates.push(`visible_columns = $${paramCount++}`); values.push(JSON.stringify(visible_columns)); }
  if (status_filter !== undefined) { updates.push(`status_filter = $${paramCount++}`); values.push(status_filter); }
  if (expires_at !== undefined) {
    updates.push(`expires_at = $${paramCount++}`);
    values.push(expires_at === '' ? null : (expires_at ? new Date(expires_at).toISOString() : null));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nenhum dado para atualizar' });

  values.push(token);
  const tokenParam = paramCount++;
  values.push(user.id);
  const userParam = paramCount++;

  try {
    const result = await pool.query(
      `UPDATE share_tokens SET ${updates.join(', ')} WHERE token = $${tokenParam} AND user_id = $${userParam} RETURNING token`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Token não encontrado ou sem permissão' });
    }
    
    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: 'Erro de banco de dados ao atualizar token' });
  }
}
