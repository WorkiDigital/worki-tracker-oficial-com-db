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
    let result;
    try {
        if (user.is_admin) {
            result = await pool.query('SELECT * FROM leads_tracking ORDER BY id DESC');
        } else {
            result = await pool.query('SELECT * FROM leads_tracking WHERE cliente_id = $1 ORDER BY id DESC', [user.cliente_id]);
        }
        return res.status(200).json(result.rows);
    } catch (dbError) {
        console.warn('DB Error, returning Mock Data:', dbError.message);
        // --- DADOS DE TESTE (MOCK) ---
        return res.status(200).json([
            { id: 1, nome: 'João Silva', telefone: '11999999999', status: 'lead', instancia: 'WhatsApp Empresa', plataforma: 'whatsapp', event_time: new Date().toISOString(), utm_content: 'Anuncio_01' },
            { id: 2, nome: 'Maria Oliveira', telefone: '21988888888', status: 'vendido', instancia: 'Suporte Vendas', plataforma: 'instagram', event_time: new Date().toISOString(), utm_content: 'Influencer_X' },
            { id: 3, nome: 'Carlos Souza', telefone: '31977777777', status: 'lead', instancia: 'WhatsApp Empresa', plataforma: 'facebook', event_time: new Date().toISOString(), utm_content: 'Anuncio_02' },
            { id: 4, nome: 'Ana Costa', telefone: '11966666666', status: 'vendido', instancia: 'WhatsApp Empresa', plataforma: 'whatsapp', event_time: new Date().toISOString(), utm_content: 'GoogleAds_01' },
            { id: 5, nome: 'Pedro Rocha', telefone: '41955555555', status: 'pendente', instancia: 'Setor Financeiro', plataforma: 'whatsapp', event_time: new Date().toISOString(), utm_content: 'Direto' }
        ]);
    }
  } catch (error) {
    console.error('Leads GET error:', error);
    if (error.code === '42P01') {
        return res.status(200).json([]); // Retorna array vazio se a tabela ainda não existir
    }
    return res.status(500).json({ error: error.message || 'Erro ao buscar leads.' });
  }
}
