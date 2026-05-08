import { getPool } from './_db.js';
import { verifyAuth, getTokenForUser } from './_auth.js';
import { cors } from './_cors.js';
import { getCachedMetrics, setCachedMetrics } from './_cache.js';
import { getClientAccountId } from './_validate.js';
import { fetchMeta } from './_meta-client.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const cliente_id = user.is_admin ? (req.query.cliente_id || user.cliente_id) : user.cliente_id;

  // 1. Métricas do Banco de Dados (Leads Tracking)
  // ─────────────────────────────────────────────────────────────
  let dbMetrics = {};
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

    whereClause += ` AND created_at >= '2026-04-30'`;

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
    dbMetrics = {
      avgCycleDays: parseFloat(row.avg_cycle_days || 0).toFixed(1),
      avgResponseMin: Math.round(parseFloat(row.avg_response_min || 0)),
      leadsAtRisk: parseInt(row.leads_at_risk || 0),
      fastSales: parseInt(row.fast_sales || 0),
      fastSalesPercent: row.total_sales > 0 ? Math.round((row.fast_sales / row.total_sales) * 100) : 0
    };
  } catch (err) {
    console.error('[DB-METRICS] Erro:', err.message);
  }

  // 2. Métricas da Meta Ads (com Cache Inteligente)
  // ─────────────────────────────────────────────────────────────
  let metaMetrics = { spend: 0, impressions: 0, clicks: 0, leads: 0, fromCache: true, maxCacheAge: 0 };
  
  try {
    const token = await getTokenForUser(user);
    const account_id = req.query.accountId || await getClientAccountId(user);

    if (token && account_id && cliente_id) {
      const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 30 * 86400000);
      const end = req.query.end ? new Date(req.query.end) : new Date();
      
      // Gera lista de datas YYYY-MM-DD para o período
      const dates = [];
      let current = new Date(start);
      while (current <= end) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }

      // Limite de segurança: não buscar mais de 31 dias de uma vez
      const datesToProcess = dates.slice(-31);
      
      for (const dateStr of datesToProcess) {
        let dayData = await getCachedMetrics(cliente_id, account_id, dateStr);
        
        if (!dayData) {
          // Cache MISS ou STALE: busca na Meta
          metaMetrics.fromCache = false;
          console.log(`[META] Fetching ${account_id} for ${dateStr}`);
          
          const url = `https://graph.facebook.com/v20.0/${account_id}/insights?` + 
            `fields=spend,impressions,clicks,actions&` +
            `time_range=${encodeURIComponent(JSON.stringify({ since: dateStr, until: dateStr }))}&` +
            `access_token=${token}`;
            
          const r = await fetchMeta(url);
          const json = await r.json();
          
          if (json.data && json.data.length > 0) {
            const insight = json.data[0];
            const leadsAction = (insight.actions || []).find(a => a.action_type === 'lead');
            
            dayData = {
              spend: parseFloat(insight.spend || 0),
              impressions: parseInt(insight.impressions || 0),
              clicks: parseInt(insight.clicks || 0),
              leads: parseInt(leadsAction?.value || 0)
            };
          } else {
            dayData = { spend: 0, impressions: 0, clicks: 0, leads: 0 };
          }
          
          // Salva no cache
          await setCachedMetrics(cliente_id, account_id, dateStr, dayData);
        } else {
          metaMetrics.maxCacheAge = Math.max(metaMetrics.maxCacheAge, dayData.cacheAge || 0);
        }
        
        // Acumula totais
        metaMetrics.spend += dayData.spend;
        metaMetrics.impressions += dayData.impressions;
        metaMetrics.clicks += dayData.clicks;
        metaMetrics.leads += dayData.leads;
      }
      
      // Cálculos derivados
      metaMetrics.ctr = metaMetrics.impressions > 0 ? (metaMetrics.clicks / metaMetrics.impressions) * 100 : 0;
      metaMetrics.cpc = metaMetrics.clicks > 0 ? metaMetrics.spend / metaMetrics.clicks : 0;
      metaMetrics.cpl = metaMetrics.leads > 0 ? metaMetrics.spend / metaMetrics.leads : 0;
    }
  } catch (err) {
    console.error('[META-METRICS] Erro:', err.message);
  }

  // 3. Resposta Combinada
  // ─────────────────────────────────────────────────────────────
  res.status(200).json({
    ...dbMetrics,
    meta: {
      spend: metaMetrics.spend.toFixed(2),
      impressions: metaMetrics.impressions,
      clicks: metaMetrics.clicks,
      leads: metaMetrics.leads,
      ctr: metaMetrics.ctr.toFixed(2) + '%',
      cpc: metaMetrics.cpc.toFixed(2),
      cpl: metaMetrics.cpl.toFixed(2),
      fromCache: metaMetrics.fromCache,
      cacheAge: metaMetrics.maxCacheAge
    }
  });
}
