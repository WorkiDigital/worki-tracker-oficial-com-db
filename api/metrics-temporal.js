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

    // Trava de segurança: Sempre ignorar dados anteriores ao início oficial do projeto (30/04/2026)
    whereClause += ` AND created_at >= '2026-04-30'`;

    // Query para métricas temporais
    const result = await pool.query(`
      SELECT 
        -- Ciclo médio de vendas (em dias)
        AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) FILTER (WHERE sale_closed_at IS NOT NULL) as avg_cycle_days,
        
        -- Tempo médio de primeira resposta (em minutos)
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL) as avg_response_min,
        
        -- Contagem de leads em risco (sem interação há mais de 48h e não finalizados)
        COUNT(*) FILTER (WHERE last_interaction_at < NOW() - INTERVAL '48 hours' AND status NOT IN ('venda_fechada', 'perdido')) as leads_at_risk,
        
        -- Vendas rápidas (fechadas em menos de 24h)
        COUNT(*) FILTER (WHERE sale_closed_at IS NOT NULL AND EXTRACT(EPOCH FROM (sale_closed_at - created_at))/3600 < 24) as fast_sales,
        
        -- Total de vendas para cálculo de percentual
        COUNT(*) FILTER (WHERE sale_closed_at IS NOT NULL) as total_sales
        
      FROM leads_tracking
      WHERE 1=1 ${whereClause}
    `, params);

    const metrics = result.rows[0];

    // Formatação amigável
    res.status(200).json({
      avgCycleDays: parseFloat(metrics.avg_cycle_days || 0).toFixed(1),
      avgResponseMin: Math.round(parseFloat(metrics.avg_response_min || 0)),
      leadsAtRisk: parseInt(metrics.leads_at_risk || 0),
      fastSales: parseInt(metrics.fast_sales || 0),
      fastSalesPercent: metrics.total_sales > 0 ? Math.round((metrics.fast_sales / metrics.total_sales) * 100) : 0
    });

  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({ error: 'Erro ao calcular métricas temporais' });
  }
}
