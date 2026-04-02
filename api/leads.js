import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return; // verifyAuth já envia os headers de erro 401.

  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID do lead é obrigatório' });

    try {
      const pool = getPool();
      let result;
      if (user.is_admin) {
        result = await pool.query('DELETE FROM leads_tracking WHERE id = $1 RETURNING id', [id]);
      } else {
        result = await pool.query('DELETE FROM leads_tracking WHERE id = $1 AND cliente_id = $2 RETURNING id', [id, user.cliente_id]);
      }
      if (result.rowCount === 0) return res.status(404).json({ error: 'Lead não encontrado ou sem permissão.' });
      return res.status(200).json({ message: 'Lead excluído com sucesso' });
    } catch (error) {
      console.error('Leads DELETE error:', error);
      return res.status(500).json({ error: error.message || 'Erro ao excluir lead.' });
    }
  }

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
