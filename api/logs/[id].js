import { verifyAuth } from '../_auth.js';
import { getPool } from '../_db.js';
import { cors } from '../_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID não fornecido' });

  const pool = getPool();
  
  try {
    // 1. Tenta buscar na tabela nova (webhook_logs)
    let resLog = await pool.query('SELECT * FROM webhook_logs WHERE id = $1', [id]);
    
    // 2. Se não encontrar, tenta na tabela antiga (logs)
    if (resLog.rows.length === 0) {
      resLog = await pool.query('SELECT * FROM logs WHERE id = $1', [id]);
    }

    const log = resLog.rows[0];

    if (!log) return res.status(404).json({ error: 'Log não encontrado' });

    // Segurança: Clientes só veem seus próprios logs
    if (!user.is_admin && log.cliente_id !== user.cliente_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    return res.status(200).json(log);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
