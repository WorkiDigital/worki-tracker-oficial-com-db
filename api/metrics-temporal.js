import { getPool } from './_db.js';
import { verifyAuth, getTokenForUser } from './_auth.js';
import { cors } from './_cors.js';
import { getCachedMetrics, setCachedMetrics } from './_cache.js';
import { getClientAccountId } from './_validate.js';
import { fetchMeta } from './_meta-client.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  try {
    const user = await verifyAuth(req, res);
    if (!user) return;

    const pool = getPool();
    const cliente_id = user.is_admin ? (req.query.cliente_id || user.cliente_id) : user.cliente_id;

    // 1. Métricas do Banco de Dados (Leads Tracking)
    let whereClause = "";
    const params = [];
    let paramCount = 1;

    if (cliente_id) {
      whereClause += ` AND cliente_id = $${paramCount}`;
      params.push(cliente_id);
      paramCount++;
    }

    if (req.query.start && req.query.end) {
      whereClause += ` AND created_at >= $${paramCount} AND created_at < $${paramCount+1}`;
      params.push(req.query.start, req.query.end);
      paramCount += 2;
    } else {
      whereClause += ` AND created_at > NOW() - INTERVAL '30 days'`;
    }

    const result = await pool.query(`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) FILTER (WHERE sale_closed_at IS NOT NULL) as avg_cycle_days,
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL) as avg_response_min,
        COUNT(*) FILTER (WHERE last_interaction_at < NOW() - INTERVAL '48 hours' AND status NOT IN ('venda_fechada', 'perdido', 'Vendido')) as leads_at_risk,
        COUNT(*) FILTER (WHERE sale_closed_at IS NOT NULL AND EXTRACT(EPOCH FROM (sale_closed_at - created_at))/3600 < 24) as fast_sales,
        COUNT(*) FILTER (WHERE sale_closed_at IS NOT NULL) as total_sales
      FROM leads_tracking
      WHERE 1=1 ${whereClause}
    `, params);

    const row = result.rows[0];
    const dbMetrics = {
      avgCycleDays: parseFloat(row.avg_cycle_days || 0).toFixed(1),
      avgResponseMin: Math.round(parseFloat(row.avg_response_min || 0)),
      leadsAtRisk: parseInt(row.leads_at_risk || 0),
      fastSales: parseInt(row.fast_sales || 0),
      fastSalesPercent: row.total_sales > 0 ? Math.round((row.fast_sales / row.total_sales) * 100) : 0
    };

    res.status(200).json(dbMetrics);

  } catch (err) {
    console.error('[METRICS-TEMPORAL] Erro Fatal:', err.message);
    res.status(500).json({ error: 'Erro interno ao calcular métricas temporais' });
  }
}
