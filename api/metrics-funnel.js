import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { ensureTrackingSchema } from './_tracking-schema.js';

const FUNIL_TZ = 'America/Sao_Paulo';
const HUMAN_CLICK_SQL = `COALESCE(user_agent, '') !~* '(bot|crawler|spider|preview|facebookexternalhit|facebot|telegrambot|slackbot|discordbot|linkedinbot|twitterbot|googlebot|bingbot)'`;

function mockFunnelMetrics() {
  return {
    overview: {
      total_leads: 30,
      untracked: 6,
      first_contact: 27,
      qualified: 16,
      proposal_sent: 10,
      scheduled: 4,
      sales: 7,
      lost: 3,
      revenue: 1791,
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
    ],
    journey: [],
    dropoff: [],
    timing: {},
    performance: []
  };
}

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

function addPeriodoParam(params, paramIdx, periodo) {
  if (periodo.tipo !== 'dias') return { periodIdx: null, paramIdx };
  params.push(periodo.dias);
  return { periodIdx: paramIdx++, paramIdx };
}

function intVal(value) {
  return Number.parseInt(value || 0, 10) || 0;
}

function numVal(value) {
  return Number.parseFloat(value || 0) || 0;
}

function pct(num, den) {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
}

function montarJornada(stages) {
  const first = stages[0]?.count || 0;
  return stages.map((stage, index) => {
    const previous = index > 0 ? stages[index - 1].count : null;
    const lost = previous === null ? 0 : Math.max(0, previous - stage.count);
    return {
      ...stage,
      cumulative_rate: pct(stage.count, first),
      step_rate: previous === null ? 100 : pct(stage.count, previous),
      lost_from_previous: lost,
      lost_rate: previous === null ? 0 : pct(lost, previous)
    };
  });
}

function montarAbandono(journey) {
  return journey.slice(1).map((stage, idx) => {
    const from = journey[idx];
    return {
      from: from?.label || '',
      to: stage.label,
      lost: stage.lost_from_previous || 0,
      lost_rate: stage.lost_rate || 0
    };
  }).sort((a, b) => b.lost_rate - a.lost_rate || b.lost - a.lost);
}

function formatStageSource(stage) {
  if (!stage?.source) return 'Sistema';
  return stage.source;
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  await ensureTrackingSchema();
  const pool = getPool();
  const cliente_id = user.is_admin ? (req.query.cliente_id || user.cliente_id) : user.cliente_id;
  if (!user.is_admin && !cliente_id) {
    return res.status(403).json({ error: 'Usuario sem cliente associado.' });
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

    const added = addPeriodoParam(params, paramIdx, periodo);
    const periodIdx = added.periodIdx;
    paramIdx = added.paramIdx;

    const leadsPeriodWhere = periodoFunilSql('created_at', periodo, periodIdx);
    const salesPeriodWhere = periodoFunilSql('sale_closed_at', periodo, periodIdx);
    const clicksPeriodWhere = periodoFunilSql('clicked_at', periodo, periodIdx);
    const pageviewsPeriodWhere = periodoFunilSql('created_at', periodo, periodIdx);

    const overviewQ = await pool.query(`
      SELECT
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE lead_origin IS NULL OR lead_origin = '' OR lead_origin = 'organic') as untracked,
        COUNT(first_response_at) as first_contact,
        COUNT(qualified_at) as qualified,
        COUNT(proposal_sent_at) as proposal_sent,
        COUNT(scheduled_at) FILTER (WHERE scheduled_at IS NOT NULL) as scheduled,
        COUNT(sale_closed_at) as sales,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('perdido','lost','descartado')) as lost,
        COALESCE(SUM(valor_venda) FILTER (WHERE sale_closed_at IS NOT NULL), 0) as revenue,
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) as avg_response_min,
        AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) as avg_cycle_days
      FROM leads_tracking
      WHERE ${leadsPeriodWhere}
      ${cliWhere}
    `, params);

    const pageviewsQ = await pool.query(`
      SELECT COUNT(*) as pageviews
      FROM tracking_pageviews
      WHERE ${pageviewsPeriodWhere}
      ${cliWhere}
    `, params);

    const clicksQ = await pool.query(`
      SELECT COUNT(*) as clicks
      FROM tracking_clicks
      WHERE ${clicksPeriodWhere}
      ${cliWhere}
      AND ${HUMAN_CLICK_SQL}
    `, params);

    const timelineQ = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'DD Mon') as date_label,
        DATE(created_at) as date_val,
        COUNT(*) FILTER (WHERE lead_origin = 'ctwa') as meta_ads,
        COUNT(*) FILTER (WHERE lead_origin = 'google') as google_ads,
        COUNT(*) FILTER (WHERE lead_origin != 'ctwa' AND lead_origin != 'google' AND lead_origin IS NOT NULL AND lead_origin != '') as other,
        COUNT(*) FILTER (WHERE lead_origin IS NULL OR lead_origin = '' OR lead_origin = 'organic') as untracked
      FROM leads_tracking
      WHERE ${leadsPeriodWhere}
      ${cliWhere}
      GROUP BY DATE(created_at), TO_CHAR(created_at, 'DD Mon')
      ORDER BY DATE(created_at) ASC
    `, params);

    const salesQ = await pool.query(`
      SELECT
        TO_CHAR(sale_closed_at, 'DD Mon') as date_label,
        DATE(sale_closed_at) as date_val,
        COUNT(*) as count,
        COALESCE(SUM(valor_venda), 0) as revenue
      FROM leads_tracking
      WHERE ${salesPeriodWhere}
      ${cliWhere}
      GROUP BY DATE(sale_closed_at), TO_CHAR(sale_closed_at, 'DD Mon')
      ORDER BY DATE(sale_closed_at) ASC
    `, params);

    const timingQ = await pool.query(`
      SELECT
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL) as first_response_min,
        AVG(EXTRACT(EPOCH FROM (qualified_at - created_at))/3600) FILTER (WHERE qualified_at IS NOT NULL) as qualified_hours,
        AVG(EXTRACT(EPOCH FROM (proposal_sent_at - created_at))/3600) FILTER (WHERE proposal_sent_at IS NOT NULL) as proposal_hours,
        AVG(EXTRACT(EPOCH FROM (scheduled_at - created_at))/3600) FILTER (WHERE scheduled_at IS NOT NULL) as scheduled_hours,
        AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) FILTER (WHERE sale_closed_at IS NOT NULL) as sale_days
      FROM leads_tracking
      WHERE ${leadsPeriodWhere}
      ${cliWhere}
    `, params);

    const performanceQ = await pool.query(`
      SELECT
        COALESCE(NULLIF(utm_campaign, ''), 'Sem campanha') as campaign,
        COALESCE(NULLIF(utm_medium, ''), 'Sem conjunto') as adset,
        COALESCE(NULLIF(utm_content, ''), 'Sem anuncio') as ad,
        COUNT(*) as contacts,
        COUNT(*) FILTER (WHERE qualified_at IS NOT NULL) as qualified,
        COUNT(*) FILTER (WHERE proposal_sent_at IS NOT NULL) as proposals,
        COUNT(*) FILTER (WHERE sale_closed_at IS NOT NULL) as sales,
        COALESCE(SUM(valor_venda) FILTER (WHERE sale_closed_at IS NOT NULL), 0) as revenue
      FROM leads_tracking
      WHERE ${leadsPeriodWhere}
      ${cliWhere}
      GROUP BY 1, 2, 3
      ORDER BY contacts DESC, sales DESC, revenue DESC
      LIMIT 12
    `, params);

    const ov = overviewQ.rows[0] || {};
    const pageviews = intVal(pageviewsQ.rows[0]?.pageviews);
    const clicks = intVal(clicksQ.rows[0]?.clicks);
    const totalLeads = intVal(ov.total_leads);

    let configuredStages = [];
    if (cliente_id) {
      const stagesQ = await pool.query(
        `SELECT id, name, event_concept, position
         FROM journey_stages
         WHERE cliente_id = $1 AND tracking_campaign_id IS NULL AND enabled IS TRUE
         ORDER BY position ASC, id ASC`,
        [cliente_id]
      );
      configuredStages = stagesQ.rows;
    }

    let journeyStages = [
      { key: 'pageview', label: 'Visualizou pagina', count: pageviews, source: 'tracking_pageviews' },
      { key: 'whatsapp_click', label: 'Clicou no WhatsApp', count: clicks, source: 'tracking_clicks' },
      { key: 'contact', label: 'Fez contato', count: totalLeads, source: 'leads_tracking' },
    ];

    if (configuredStages.length) {
      const stageParams = [cliente_id, configuredStages.map(s => Number(s.id))];
      let stageParamIdx = 3;
      const stageAdded = addPeriodoParam(stageParams, stageParamIdx, periodo);
      const stagePeriodWhere = periodoFunilSql('h.created_at', periodo, stageAdded.periodIdx);
      const stageCountsQ = await pool.query(
        `SELECT h.stage_id, COUNT(DISTINCT h.lead_id)::int AS total
         FROM lead_journey_history h
         WHERE h.cliente_id = $1
           AND h.stage_id = ANY($2::int[])
           AND ${stagePeriodWhere}
         GROUP BY h.stage_id`,
        stageParams
      );
      const counts = new Map(stageCountsQ.rows.map(r => [Number(r.stage_id), intVal(r.total)]));
      journeyStages.push(...configuredStages.map(stage => ({
        key: `stage_${stage.id}`,
        label: stage.name,
        count: counts.get(Number(stage.id)) || 0,
        source: `jornada:${stage.event_concept}`,
      })));
    } else {
      journeyStages.push(
        { key: 'first_response', label: 'Foi atendido', count: intVal(ov.first_contact), source: 'first_response_at' },
        { key: 'qualified', label: 'Foi qualificado', count: intVal(ov.qualified), source: 'qualified_at' },
        { key: 'proposal', label: 'Recebeu proposta', count: intVal(ov.proposal_sent), source: 'proposal_sent_at' },
        { key: 'scheduled', label: 'Agendou', count: intVal(ov.scheduled), source: 'scheduled_at' },
        { key: 'purchase', label: 'Comprou', count: intVal(ov.sales), source: 'sale_closed_at' },
        { key: 'lost', label: 'Foi perdido', count: intVal(ov.lost), source: 'status' },
      );
    }

    journeyStages = journeyStages.map(stage => ({ ...stage, source_label: formatStageSource(stage) }));
    const journey = montarJornada(journeyStages);
    const dropoff = montarAbandono(journey);
    const performance = performanceQ.rows.map(row => ({
      campaign: row.campaign,
      adset: row.adset,
      ad: row.ad,
      contacts: intVal(row.contacts),
      qualified: intVal(row.qualified),
      proposals: intVal(row.proposals),
      sales: intVal(row.sales),
      revenue: numVal(row.revenue),
      close_rate: pct(intVal(row.sales), intVal(row.contacts)),
    }));

    res.status(200).json({
      overview: ov,
      timeline: timelineQ.rows,
      sales_timeline: salesQ.rows,
      journey,
      dropoff,
      timing: timingQ.rows[0] || {},
      performance,
    });
  } catch (error) {
    console.error('Funnel metrics error:', error);
    if (process.env.NODE_ENV !== 'production') return res.status(200).json(mockFunnelMetrics());
    res.status(500).json({ error: 'Erro ao calcular metricas de funil' });
  }
}
