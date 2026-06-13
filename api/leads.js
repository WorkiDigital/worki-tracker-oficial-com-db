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
    const requestedClient = req.query.cliente_id;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit || '500', 10)));
    const offset = (page - 1) * limit;
    const { start, end } = req.query;

    try {
        // Monta WHERE dinâmico: escopo de cliente + janela de datas (start/end vindos do front).
        const where = [];
        const params = [];
        let i = 1;

        if (user.is_admin) {
            if (requestedClient) { where.push(`cliente_id = $${i++}`); params.push(requestedClient); }
        } else {
            where.push(`cliente_id = $${i++}`); params.push(user.cliente_id);
        }
        if (start) { where.push(`created_at >= $${i++}`); params.push(start); }
        if (end)   { where.push(`created_at <  $${i++}`); params.push(end); }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        params.push(limit); const limitIdx = i++;
        params.push(offset); const offsetIdx = i++;

        const result = await pool.query(
            `SELECT * FROM leads_tracking ${whereSql} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            params
        );
        return res.status(200).json(result.rows);
    } catch (dbError) {
        console.warn('DB Error, returning Mock Data:', dbError.message);
        if (process.env.NODE_ENV === 'production') {
            throw dbError;
        }
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
