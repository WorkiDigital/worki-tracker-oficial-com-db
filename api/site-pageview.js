/**
 * POST /api/site-pageview
 *
 * Registra um PageView vindo do script público (wapptrack.js) instalado em
 * páginas externas ao painel. Endpoint público (sem auth) — a segurança vem
 * de resolver tudo pelo slug da campanha (nunca aceita cliente_id do browser)
 * e, opcionalmente, da lista de domínios autorizados da campanha.
 *
 * Separado de tracking_clicks: aqui é só visualização de página, não clique
 * real no botão WhatsApp (isso é o /api/site-whatsapp-click).
 */
import crypto from 'crypto';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { enviarCapiWebPageView } from './_capi-web.js';
import { extractClientIp } from './_geoip.js';
import { rateLimitByIp } from './_rate-limit-ip.js';

function dominioPermitido(campaign, origin) {
  const lista = campaign.allowed_domains || [];
  if (!lista.length) return true;
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return lista.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

function gerarVisitorId() {
  return crypto.randomBytes(12).toString('hex');
}

async function gravarLog(pool, { cliente_id, tag, level, message, data }) {
  try {
    await pool.query(
      `INSERT INTO webhook_logs (cliente_id, instance, tag, level, message, data)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [cliente_id || null, 'site-script', tag, level || 'info', message, JSON.stringify(data || {})]
    );
  } catch { /* best-effort */ }
}

export default async function handler(req, res) {
  if (cors(req, res, ['POST'], { public: true, openOrigin: true })) return;
  if (await rateLimitByIp(req, res)) return;

  await ensureTrackingSchema();
  const pool = getPool();

  const body = req.body || {};
  const slug = String(body.campaign || '').trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    return res.status(400).json({ error: 'campaign inválida' });
  }

  const campRes = await pool.query(
    'SELECT * FROM tracking_campaigns WHERE slug = $1 AND enabled = true AND archived_at IS NULL',
    [slug]
  );
  const campaign = campRes.rows[0];
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada ou desativada.' });

  const origin = req.headers.origin || req.headers.referer || '';
  if (!dominioPermitido(campaign, origin)) {
    return res.status(403).json({ error: 'Domínio não autorizado para esta campanha.' });
  }

  const clean = (v, max = 255) => String(v || '').trim().slice(0, max) || null;
  const visitorId = clean(body.visitor_id, 60) || gerarVisitorId();
  const ip = extractClientIp(req);
  const userAgent = clean(req.headers['user-agent'], 500);
  const pageUrl = clean(body.page_url, 2000);
  const pageTitle = clean(body.page_title, 500);
  const referrer = clean(body.referrer, 2000);
  const utm_source = clean(body.utm_source);
  const utm_medium = clean(body.utm_medium);
  const utm_campaign = clean(body.utm_campaign);
  const utm_content = clean(body.utm_content);
  const fbclid = clean(body.fbclid, 512);
  const fbp = clean(body.fbp, 255);
  const fbc = fbclid ? `fb.1.${Date.now()}.${fbclid}` : (clean(body.fbc, 512));
  const gclid = clean(body.gclid, 512);
  const gbraid = clean(body.gbraid, 512);
  const wbraid = clean(body.wbraid, 512);
  const pageviewEventId = `pv_${visitorId}_${Date.now().toString(36)}`;

  await pool.query(
    `INSERT INTO tracking_pageviews
      (visitor_id, campaign_id, cliente_id, page_url, page_title, referrer,
       utm_source, utm_medium, utm_campaign, utm_content, fbclid, fbc, fbp,
       ip_address, user_agent, pageview_event_id, gclid, gbraid, wbraid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [visitorId, campaign.id, campaign.cliente_id, pageUrl, pageTitle, referrer,
     utm_source, utm_medium, utm_campaign, utm_content, fbclid, fbc, fbp,
     ip, userAgent, pageviewEventId, gclid, gbraid, wbraid]
  );

  // PageView server-side via CAPI Web (best-effort) + devolve o pixel_id para o
  // script disparar o Pixel no navegador com o MESMO event_id → Meta deduplica.
  // Também devolve as credenciais Google Ads (client-side only, sem servidor) para
  // o wapptrack.js disparar o gtag.js quando o clique vier com gclid.
  let capiSent = false;
  let capiPixelId = null;
  let googleAdsId = null;
  let googleAdsLabel = null;
  try {
    const px = await pool.query(
      'SELECT capi_pixel_id, google_ads_conversion_id, google_ads_conversion_label FROM clientes WHERE id = $1',
      [campaign.cliente_id]
    );
    capiPixelId = px.rows[0]?.capi_pixel_id || null;
    googleAdsId = px.rows[0]?.google_ads_conversion_id || null;
    googleAdsLabel = px.rows[0]?.google_ads_conversion_label || null;
    if (capiPixelId) {
      const r = await enviarCapiWebPageView(pool, {
        cliente_id: campaign.cliente_id,
        eventId: pageviewEventId,
        click: { fbc, fbp, ip_address: ip, user_agent: userAgent, referrer, event_source_url: pageUrl },
      });
      capiSent = r.sent;
      await pool.query('UPDATE tracking_pageviews SET capi_web_status=$1 WHERE pageview_event_id=$2',
        [r.sent ? 'pv_sent' : 'pv_failed', pageviewEventId]);
    }
  } catch (_) { /* best-effort */ }

  // Qualquer um dos 3 identificadores de clique do Google (gclid, ou gbraid/wbraid
  // nos fluxos sem cookie de terceiros — iOS/Safari, Performance Max) habilita a
  // conversão client-side no clique do botão do WhatsApp.
  const temIdentificadorGoogle = !!(gclid || gbraid || wbraid);

  await gravarLog(pool, {
    cliente_id: campaign.cliente_id, tag: 'site_pageview', level: 'info',
    message: `PageView do site (campanha "${campaign.name}")`,
    data: { visitor_id: visitorId, page_url: pageUrl, capi_sent: capiSent, fbclid: !!fbclid,
            gclid: !!gclid, gbraid: !!gbraid, wbraid: !!wbraid,
            google_ads_configurado: !!(googleAdsId && googleAdsLabel) },
  });

  return res.status(200).json({
    visitor_id: visitorId,
    pageview_event_id: pageviewEventId,
    pixel_id: capiPixelId,
    button_text: campaign.button_text || null,
    google_ads_id: (temIdentificadorGoogle && googleAdsId && googleAdsLabel) ? googleAdsId : null,
    google_ads_label: (temIdentificadorGoogle && googleAdsId && googleAdsLabel) ? googleAdsLabel : null,
  });
}
