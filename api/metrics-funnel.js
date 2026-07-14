import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

function mockFunnelMetrics() {
  return {
    overview: {
      total_leads: 30,
      untracked: 6,
      first_contact: 27,
      qualified: 16,
      proposal_sent: 10,
      sales: 7,
      avg_response_min: 42,
      avg_cycle_days: 1.8
    },
    timeline: [
      { date_label: '01 Jul', date_val: '2026-07-01', meta_ads: 5, google_ads: 2, other: 1, untracked: 1 },
      { date_label: '02 Jul', date_val: '2026-07-02', meta_ads: 7, google_ads: 3, other: 2, untracked: 1 },
      { date_label: '03 Jul', date_val: '2026-07-03', meta_ads: 4, google_ads: 4, other: 1, untracked: 2 },
      { date_label: '04 Jul', date_val: '2026-07-04', meta_ads: 8, google_ads: 3, other: 2, untracked: 2 },
      { date_label: '05 Jul', date_val: '2026-07-05', meta_ads: 6, google_ads: 5, other: 1, untracked: 0 }
    ],
    sales_timeline: [
      { date_label: '01 Jul', date_val: '2026-07-01', count: 1, revenue: 497 },
      { date_label: '02 Jul', date_val: '2026-07-02', count: 2, revenue: 994 },
      { date_label: '04 Jul', date_val: '2026-07-04', count: 1, revenue: 797 },
      { date_label: '05 Jul', date_val: '2026-07-05', count: 3, revenue: 1791 }
    ]
  };
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const cliente_id = user.is_admin ? (req.query.cliente_id || user.cliente_id) : user.cliente_id;
  // Defesa contra dado inconsistente: usuário não-admin SEMPRE precisa ter
  // cliente_id (senão a query abaixo rodaria sem filtro e vazaria todos os
  // clientes). Admin sem cliente selecionado continua vendo a visão agregada.
  if (!user.is_admin && !cliente_id) {
    return res.status(403).json({ error: 'Usuário sem cliente associado.' });
  }
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
    if (process.env.NODE_ENV !== 'production') return res.status(200).json(mockFunnelMetrics());
    res.status(500).json({ error: 'Erro ao calcular metricas de funil' });
  }
}
