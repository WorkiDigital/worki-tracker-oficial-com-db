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

const FUNIL_TZ = 'America/Sao_Paulo';

function normalizarPeriodoFunil(raw) {
  const value = String(raw || '30');
  if (value === 'hoje' || value === 'ontem' || value === 'hojeOntem') return { tipo: value };
  const dias = Number.parseInt(value, 10);
  return { tipo: 'dias', dias: Number.isFinite(dias) && dias > 0 ? Math.min(dias, 365) : 30 };
}

function periodoFunilSql(column, periodo, periodParamIdx) {
  const base = `date_trunc('day', NOW() AT TIME ZONE '${FUNIL_TZ}')`;
  if (periodo.tipo === 'hoje') {
    return `${column} >= (${base} AT TIME ZONE '${FUNIL_TZ}') AND ${column} < ((${base} + INTERVAL '1 day') AT TIME ZONE '${FUNIL_TZ}')`;
  }
  if (periodo.tipo === 'ontem') {
    return `${column} >= ((${base} - INTERVAL '1 day') AT TIME ZONE '${FUNIL_TZ}') AND ${column} < (${base} AT TIME ZONE '${FUNIL_TZ}')`;
  }
  if (periodo.tipo === 'hojeOntem') {
    return `${column} >= ((${base} - INTERVAL '1 day') AT TIME ZONE '${FUNIL_TZ}') AND ${column} < ((${base} + INTERVAL '1 day') AT TIME ZONE '${FUNIL_TZ}')`;
  }
  return `${column} > NOW() - INTERVAL '1 day' * $${periodParamIdx}`;
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
  const periodo = normalizarPeriodoFunil(req.query.periodo);

  try {
    let cliWhere = '';
    const params = [];
    let paramIdx = 1;

    if (cliente_id) {
      cliWhere = `AND cliente_id = $${paramIdx++}`;
      params.push(cliente_id);
    }
    
    let periodIdx = null;
    if (periodo.tipo === 'dias') {
      params.push(periodo.dias);
      periodIdx = paramIdx++;
    }
    const leadsPeriodWhere = periodoFunilSql('created_at', periodo, periodIdx);
    const salesPeriodWhere = periodoFunilSql('sale_closed_at', periodo, periodIdx);

    // 1. Overview and Funnel
    // total_leads/untracked/first_contact/qualified/proposal_sent contam por
    // ENTRADA do lead no período (created_at) — faz sentido, é sobre o topo
    // do funil. "sales" (usado no card "Comprou") é calculado À PARTE logo
    // abaixo, filtrando por sale_closed_at — senão um lead que entrou fora
    // do período mas comprou dentro dele nunca aparecia aqui, divergindo do
    // card de Faturamento ao lado (que já usa sale_closed_at corretamente).
    // Confirmado com dados reais: 3 vendas fecharam no período "hoje e
    // ontem", mas só 1 lead tinha ENTRADO também dentro dessa janela.
    const overviewQ = await pool.query(`
      SELECT
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE lead_origin IS NULL OR lead_origin = '' OR lead_origin = 'organic') as untracked,
        COUNT(*) FILTER (WHERE first_response_at IS NOT NULL OR LOWER(COALESCE(status,'')) NOT IN ('lead','novo','')) as first_contact,
        COUNT(qualified_at) as qualified,
        COUNT(proposal_sent_at) as proposal_sent,
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL) as avg_response_min,
        AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) as avg_cycle_days
      FROM leads_tracking
      WHERE ${leadsPeriodWhere}
      ${cliWhere}
    `, params);

    const salesCountQ = await pool.query(`
      SELECT COUNT(*) as sales
      FROM leads_tracking
      WHERE ${salesPeriodWhere}
      ${cliWhere}
    `, params);
    overviewQ.rows[0].sales = salesCountQ.rows[0].sales;

    // 2. Timeline Origem das Conversas (por dia)
    // ATENÇÃO: lead_origin é sobre o MECANISMO de captura (ctwa/organic/bio/
    // campaign_link/rotator/intelligent) — nunca vale 'google', então o filtro
    // antigo (lead_origin = 'google') sempre dava 0 e todo lead vindo do
    // Google Ads via link rastreável caía em "other". A plataforma de anúncio
    // real vem de `plataforma`, com fallback em `utm_source` — mesmo critério
    // já usado na coluna Plataforma da tabela de Leads (js/leads.js, função
    // renderTabela). CTWA é sempre Meta (não tem como um anúncio de clique-
    // pra-WhatsApp nativo ser do Google).
    const timelineQ = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'DD Mon') as date_label,
        DATE(created_at) as date_val,
        COUNT(*) FILTER (
          WHERE lead_origin = 'ctwa'
             OR LOWER(COALESCE(plataforma,'')) IN ('facebook','instagram')
             OR (COALESCE(plataforma,'') = '' AND (LOWER(COALESCE(utm_source,'')) LIKE '%fb%' OR LOWER(COALESCE(utm_source,'')) LIKE '%face%' OR LOWER(COALESCE(utm_source,'')) LIKE '%ig%' OR LOWER(COALESCE(utm_source,'')) LIKE '%insta%'))
        ) as meta_ads,
        COUNT(*) FILTER (
          WHERE lead_origin != 'ctwa'
            AND (LOWER(COALESCE(plataforma,'')) = 'google'
                 OR (COALESCE(plataforma,'') = '' AND (LOWER(COALESCE(utm_source,'')) LIKE '%google%' OR LOWER(COALESCE(utm_source,'')) LIKE '%adwords%')))
        ) as google_ads,
        COUNT(*) FILTER (
          WHERE lead_origin != 'ctwa'
            AND lead_origin IS NOT NULL AND lead_origin != '' AND lead_origin != 'organic'
            AND LOWER(COALESCE(plataforma,'')) NOT IN ('facebook','instagram','google')
            AND NOT (COALESCE(plataforma,'') = '' AND (LOWER(COALESCE(utm_source,'')) LIKE '%fb%' OR LOWER(COALESCE(utm_source,'')) LIKE '%face%' OR LOWER(COALESCE(utm_source,'')) LIKE '%ig%' OR LOWER(COALESCE(utm_source,'')) LIKE '%insta%' OR LOWER(COALESCE(utm_source,'')) LIKE '%google%' OR LOWER(COALESCE(utm_source,'')) LIKE '%adwords%'))
        ) as other,
        COUNT(*) FILTER (WHERE lead_origin IS NULL OR lead_origin = '' OR lead_origin = 'organic') as untracked
      FROM leads_tracking
      WHERE ${leadsPeriodWhere}
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
      WHERE ${salesPeriodWhere}
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
