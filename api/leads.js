import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return; // verifyAuth já envia os headers de erro 401.

  try {
    const pool = getPool();
    let result;
    if (user.is_admin) {
        // Admin geral vê tudo (ou pode filtrar no futuro)
        result = await pool.query('SELECT * FROM leads_tracking ORDER BY id DESC');
    } else {
        // Cliente SÓ VÊ o que pertence à sua loja
        result = await pool.query('SELECT * FROM leads_tracking WHERE cliente_id = $1 ORDER BY id DESC', [user.cliente_id]);
    }
    
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Leads GET error:', error);
    if (error.code === '42P01') {
        return res.status(200).json([]); // Retorna array vazio se a tabela ainda não existir
    }
    return res.status(500).json({ error: error.message || 'Erro ao buscar leads.' });
  }
}
