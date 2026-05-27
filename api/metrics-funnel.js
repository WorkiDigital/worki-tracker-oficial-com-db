import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const cliente_id = user.is_admin ? req.query.cliente_id : user.cliente_id;

  try {
    const whereClause = cliente_id ? 'AND cliente_id = $1' : '';
    const params = cliente_id ? [cliente_id] : [];

    // Funil Temporal: Mapeia as transições entre estados
    const funnel = await pool.query(`
      SELECT 
        COUNT(*) as total_leads,
        COUNT(first_response_at) as first_contact,
        COUNT(qualified_at) as qualified,
        COUNT(proposal_sent_at) as proposal_sent,
        COUNT(sale_closed_at) as sales,
        
        -- Tempos médios (em horas)
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) as avg_time_to_contact,
        AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/3600) as avg_time_to_sale
        
      FROM leads_tracking
      WHERE created_at > NOW() - INTERVAL '30 days'
      ${whereClause}
    `, params);

    res.status(200).json(funnel.rows[0]);

  } catch (error) {
    console.error('Funnel metrics error:', error);
    res.status(500).json({ error: 'Erro ao calcular métricas de funil' });
  }
}
