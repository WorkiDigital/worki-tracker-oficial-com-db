import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return; // verifyAuth já envia os headers de erro 401.

  try {
    const pool = getPool();
    // No Postgres puro, precisamos buscar a tabela (no Easypanel o default é public.leads_tracking)
    const result = await pool.query('SELECT * FROM leads_tracking ORDER BY id DESC');
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Leads GET error:', error);
    if (error.code === '42P01') {
        return res.status(200).json([]); // Retorna array vazio se a tabela ainda não existir
    }
    return res.status(500).json({ error: error.message || 'Erro ao buscar leads.' });
  }
}
