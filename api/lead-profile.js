import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { parseUserAgent } from './_device.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  try {
    const pool = getPool();

    // Busca o lead principal com todas as colunas relevantes
    const leadRes = await pool.query(`
      SELECT
        id, nome, telefone, status, plataforma, instancia,
        created_at, event_time, first_response_at, sale_closed_at, qualified_at,
        utm_campaign, utm_medium, utm_content, utm_source, source_id,
        mensagem_recebida, valor_venda,
        email, cpf, endereco, cidade, estado, produto,
        ctw_aci_id, cliente_id, page_id, lead_origin,
        tracking_click_id, tracking_campaign_id, tracking_method,
        (SELECT name FROM tracking_campaigns WHERE id = leads_tracking.tracking_campaign_id) AS tracking_campaign_name
      FROM leads_tracking
      WHERE id = $1
    `, [id]);

    if (!leadRes.rows.length) return res.status(404).json({ error: 'Lead não encontrado' });
    const lead = leadRes.rows[0];

    // Segurança: não-admin só acessa leads do próprio cliente
    if (!user.is_admin && lead.cliente_id !== user.cliente_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Leads do mesmo telefone (no modelo de contato único costuma ser 1, mas pode
    // haver histórico de antes da mudança — mantemos todos).
    const jornadaRes = await pool.query(`
      SELECT
        id, created_at, status, utm_campaign, utm_medium, utm_content,
        source_id, plataforma, instancia, mensagem_recebida,
        first_response_at, sale_closed_at, valor_venda, produto, ctw_aci_id,
        lead_origin, tracking_campaign_id, tracking_method,
        (SELECT name FROM tracking_campaigns WHERE id = leads_tracking.tracking_campaign_id) AS tracking_campaign_name
      FROM leads_tracking
      WHERE telefone = $1 AND cliente_id = $2
      ORDER BY created_at ASC
    `, [lead.telefone, lead.cliente_id]);

    const leadIds = jornadaRes.rows.map(r => r.id);

    // Interações de link rastreável: cada clique (toque) vinculado a qualquer lead
    // deste telefone. É a fonte real da jornada agora que cliques repetidos não
    // viram leads novos (contato único). Traz UTMs, campanha e user_agent do toque.
    let cliques = [];
    if (leadIds.length) {
      const cliquesRes = await pool.query(`
        SELECT
          k.id, k.clicked_at, k.converted_at, k.utm_campaign, k.utm_medium,
          k.utm_content, k.utm_source, k.user_agent, k.fbc, k.lead_id,
          k.ip_address, k.geo_city, k.geo_region, k.geo_region_code,
          k.geo_country, k.geo_country_code,
          k.placement, k.ad_id, k.adset_id, k.meta_campaign_id, k.gclid, k.google_ads_keyword,
          k.campaign_id AS tracking_campaign_id,
          c.name AS tracking_campaign_name, c.origin_type
        FROM tracking_clicks k
        LEFT JOIN tracking_campaigns c ON c.id = k.campaign_id
        WHERE k.lead_id = ANY($1::int[])
        ORDER BY k.clicked_at ASC
      `, [leadIds]);
      cliques = cliquesRes.rows.map(k => ({
        ...k,
        device: parseUserAgent(k.user_agent),
      }));
    }

    // Dispositivo do lead principal: do clique que o originou (tracking_click_id).
    let leadDevice = null;
    if (lead.tracking_click_id) {
      const principal = cliques.find(k => k.id === lead.tracking_click_id);
      if (principal) leadDevice = principal.device;
    }
    if (!leadDevice && cliques.length) leadDevice = cliques[0].device;
    lead.device = leadDevice;
    const principalClick = lead.tracking_click_id
      ? cliques.find(k => k.id === lead.tracking_click_id)
      : cliques[0];
    lead.click_location = principalClick ? {
      ip: principalClick.ip_address || null,
      city: principalClick.geo_city || null,
      region: principalClick.geo_region || null,
      region_code: principalClick.geo_region_code || null,
      country: principalClick.geo_country || null,
      country_code: principalClick.geo_country_code || null,
    } : null;
    // Parâmetros do anúncio capturados no clique (placement, IDs Meta, gclid).
    lead.click_ad = principalClick ? {
      placement: principalClick.placement || null,
      ad_id: principalClick.ad_id || null,
      adset_id: principalClick.adset_id || null,
      meta_campaign_id: principalClick.meta_campaign_id || null,
      gclid: principalClick.gclid || null,
      google_ads_keyword: principalClick.google_ads_keyword || null,
    } : null;

    return res.status(200).json({
      lead,
      jornada: jornadaRes.rows,
      interacoes: cliques,
    });

  } catch (err) {
    console.error('[lead-profile]', err.message);
    if (err.code === '42P01' || err.code === '42703') {
      try {
        const pool = getPool();
        const legacyLead = await pool.query(`
          SELECT
            id, nome, telefone, status, plataforma, instancia,
            created_at, event_time, first_response_at, sale_closed_at, qualified_at,
            utm_campaign, utm_medium, utm_content, source_id,
            mensagem_recebida, valor_venda,
            email, cpf, endereco, cidade, estado, produto,
            ctw_aci_id, cliente_id, page_id, lead_origin
          FROM leads_tracking WHERE id=$1
        `, [id]);
        if (!legacyLead.rows.length) return res.status(404).json({ error: 'Lead não encontrado' });
        const lead = legacyLead.rows[0];
        if (!user.is_admin && lead.cliente_id !== user.cliente_id) {
          return res.status(403).json({ error: 'Acesso negado' });
        }
        const legacyJourney = await pool.query(`
          SELECT
            id, created_at, status, utm_campaign, utm_medium, utm_content,
            source_id, plataforma, instancia, mensagem_recebida,
            first_response_at, sale_closed_at, valor_venda, produto, ctw_aci_id, lead_origin
          FROM leads_tracking
          WHERE telefone=$1 AND cliente_id=$2
          ORDER BY created_at ASC
        `, [lead.telefone, lead.cliente_id]);
        return res.status(200).json({ lead, jornada: legacyJourney.rows });
      } catch (fallbackError) {
        console.error('[lead-profile:fallback]', fallbackError.message);
      }
    }
    return res.status(500).json({ error: err.message });
  }
}
