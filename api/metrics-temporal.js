import { getPool } from './_db.js';
import { verifyAuth, getTokenForUser } from './_auth.js';
import { cors } from './_cors.js';
import { getCachedMetrics, setCachedMetrics } from './_cache.js';
import { getClientAccountId } from './_validate.js';
import { fetchMeta } from './_meta-client.js';

function mockTemporalMetrics() {
  return {
    avgCycleDays: '1.8',
    avgCycleLabel: { value: '1.8', unit: 'dias ate venda' },
    avgResponseMin: 42,
    leadsAtRisk: 4,
    fastSales: 3,
    fastSalesPercent: 43
  };
}

// Formata o ciclo médio na unidade adequada à escala (vendas rápidas dão fração de dia).
// Retorna { value, unit } para o front exibir, ex: "42" / "min", "5.2" / "h", "3.1" / "dias".
function formatCycle(days, totalSales) {
  if (!totalSales || totalSales < 1 || !days) return { value: '—', unit: 'sem vendas' };
  const hours = days * 24;
  if (hours < 1)  return { value: Math.round(hours * 60).toString(), unit: 'min até venda' };
  if (days < 1)   return { value: hours.toFixed(1), unit: 'horas até venda' };
  return { value: days.toFixed(1), unit: 'dias até venda' };
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  try {
    const user = await verifyAuth(req, res);
    if (!user) return;

    const pool = getPool();
    const cliente_id = user.is_admin ? (req.query.cliente_id || user.cliente_id) : user.cliente_id;

    // 1. Métricas do Banco de Dados (Leads Tracking)
    // Métricas de lead (criação) filtram por created_at; métricas de venda filtram por sale_closed_at.
    // Isso garante que "Ciclo médio" e "Vendas rápidas" reflitam o período em que a venda ocorreu.
    let cliWhere = "";
    const params = [];
    let paramCount = 1;

    if (cliente_id) {
      cliWhere = ` AND cliente_id = $${paramCount}`;
      params.push(cliente_id);
      paramCount++;
    }

    let leadDateFilter, saleDateFilter;
    if (req.query.start && req.query.end) {
      leadDateFilter = ` AND created_at >= $${paramCount} AND created_at < $${paramCount+1}`;
      saleDateFilter = ` AND sale_closed_at >= $${paramCount} AND sale_closed_at < $${paramCount+1}`;
      params.push(req.query.start, req.query.end);
      paramCount += 2;
    } else {
      leadDateFilter = ` AND created_at > NOW() - INTERVAL '30 days'`;
      saleDateFilter = ` AND sale_closed_at > NOW() - INTERVAL '30 days'`;
    }

    const result = await pool.query(`
      SELECT
        (SELECT AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400)
         FROM leads_tracking WHERE 1=1 ${cliWhere}${saleDateFilter} AND sale_closed_at IS NOT NULL) as avg_cycle_days,
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL) as avg_response_min,
        COUNT(*) FILTER (WHERE last_interaction_at < NOW() - INTERVAL '48 hours' AND status NOT IN ('venda_fechada', 'perdido', 'Vendido', 'Agendado')) as leads_at_risk,
        (SELECT COUNT(*) FROM leads_tracking WHERE 1=1 ${cliWhere}${saleDateFilter}
         AND sale_closed_at IS NOT NULL AND EXTRACT(EPOCH FROM (sale_closed_at - created_at))/3600 < 24) as fast_sales,
        (SELECT COUNT(*) FROM leads_tracking WHERE 1=1 ${cliWhere}${saleDateFilter}
         AND sale_closed_at IS NOT NULL) as total_sales
      FROM leads_tracking
      WHERE 1=1 ${cliWhere}${leadDateFilter}
    `, params);

    const row = result.rows[0];
    const cycleDaysRaw = parseFloat(row.avg_cycle_days || 0); // valor cru em dias (pode ser fracionário)
    const dbMetrics = {
      avgCycleDays: cycleDaysRaw.toFixed(1),                 // mantido p/ compatibilidade
      avgCycleLabel: formatCycle(cycleDaysRaw, row.total_sales), // rótulo já formatado (h/dias)
      avgResponseMin: Math.round(parseFloat(row.avg_response_min || 0)),
      leadsAtRisk: parseInt(row.leads_at_risk || 0),
      fastSales: parseInt(row.fast_sales || 0),
      fastSalesPercent: row.total_sales > 0 ? Math.round((row.fast_sales / row.total_sales) * 100) : 0
    };

    res.status(200).json(dbMetrics);

  } catch (err) {
    console.error('[METRICS-TEMPORAL] Erro Fatal:', err.message);
    if (process.env.NODE_ENV !== 'production') return res.status(200).json(mockTemporalMetrics());
    res.status(500).json({ error: 'Erro interno ao calcular metricas temporais' });
  }
}
