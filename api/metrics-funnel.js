import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const cliente_id = user.is_admin ? (req.query.cliente_id || user.cliente_id) : user.cliente_id;
  const periodo = req.query.periodo || '30'; // in days

  try {
    let cliWhere = '';
    const params = [];
    let paramIdx = 1;

    if (cliente_id) {
      cliWhere = `AND cliente_id = $${paramIdx++}`;
      params.push(cliente_id);
    }
    
    // Add period parameter
    params.push(parseInt(periodo, 10));
    const periodIdx = paramIdx;

    // 1. Overview and Funnel
    const overviewQ = await pool.query(`
      SELECT 
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE lead_origin IS NULL OR lead_origin = '' OR lead_origin = 'organic') as untracked,
        COUNT(first_response_at) as first_contact,
        COUNT(qualified_at) as qualified,
        COUNT(proposal_sent_at) as proposal_sent,
        COUNT(sale_closed_at) as sales,
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) as avg_response_min,
        AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) as avg_cycle_days
      FROM leads_tracking
      WHERE created_at > NOW() - INTERVAL '1 day' * $${periodIdx}
      ${cliWhere}
    `, params);

    // 2. Timeline Origem das Conversas (por dia)
    const timelineQ = await pool.query(`
      SELECT 
        TO_CHAR(created_at, 'DD Mon') as date_label,
        DATE(created_at) as date_val,
        COUNT(*) FILTER (WHERE lead_origin = 'ctwa') as meta_ads,
        COUNT(*) FILTER (WHERE lead_origin = 'google') as google_ads,
        COUNT(*) FILTER (WHERE lead_origin != 'ctwa' AND lead_origin != 'google' AND lead_origin IS NOT NULL AND lead_origin != '') as other,
        COUNT(*) FILTER (WHERE lead_origin IS NULL OR lead_origin = '' OR lead_origin = 'organic') as untracked
      FROM leads_tracking
      WHERE created_at > NOW() - INTERVAL '1 day' * $${periodIdx}
      ${cliWhere}
      GROUP BY DATE(created_at), TO_CHAR(created_at, 'DD Mon')
      ORDER BY DATE(created_at) ASC
    `, params);

    // 3. Timeline de Vendas e Faturamento
    const salesQ = await pool.query(`
      SELECT 
        TO_CHAR(sale_closed_at, 'DD Mon') as date_label,
        DATE(sale_closed_at) as date_val,
        COUNT(*) as count,
        SUM(valor_venda) as revenue
      FROM leads_tracking
      WHERE sale_closed_at > NOW() - INTERVAL '1 day' * $${periodIdx}
      ${cliWhere}
      GROUP BY DATE(sale_closed_at), TO_CHAR(sale_closed_at, 'DD Mon')
      ORDER BY DATE(sale_closed_at) ASC
    `, params);

    res.status(200).json({
      overview: overviewQ.rows[0],
      timeline: timelineQ.rows,
      sales_timeline: salesQ.rows
    });

  } catch (error) {
    console.error('Funnel metrics error:', error);
    res.status(500).json({ error: 'Erro ao calcular métricas de funil' });
  }
}
