/**
 * POST /api/site-whatsapp-click
 *
 * Equivalente programático do api/redirect.js, para uso pelo script público
 * (wapptrack.js) instalado em páginas externas. Recebe campanha (slug),
 * página atual, UTMs e mensagem opcional; devolve a URL final do WhatsApp
 * já com o token invisível embutido. O clique é gravado em tracking_clicks
 * com status 'clicked' — a CONVERSÃO continua sendo feita pelo webhook atual
 * (api/webhook-evo.js) quando a mensagem chega, sem nenhuma mudança lá.
 *
 * Segurança: nunca aceita cliente_id do browser — tudo é resolvido pelo slug.
 */
import crypto from 'crypto';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { selecionarDestino } from './_rotator.js';
import { encodeToken } from './_invisible-token.js';
import { extractClientIp, lookupGeoIp } from './_geoip.js';
import { formatarMensagemDinamica } from './redirect.js';
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

function gerarTrackingId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function gerarTrackingIdUnico(client) {
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const trackingId = gerarTrackingId();
    const existe = await client.query('SELECT 1 FROM tracking_clicks WHERE tracking_id=$1 LIMIT 1', [trackingId]);
    if (!existe.rows.length) return trackingId;
  }
  throw new Error('Não foi possível gerar um identificador único para o clique.');
}

function inserirTokenNaMensagem(texto, token) {
  const mensagem = String(texto || '');
  if (!token) return mensagem;
  const palavra = /[\p{L}\p{N}]{4,}/u.exec(mensagem);
  if (!palavra) return token + mensagem;
  const ponto = palavra.index + Math.max(2, Math.floor(palavra[0].length / 2));
  return mensagem.slice(0, ponto) + token + mensagem.slice(ponto);
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

  const client = await pool.connect();
  try {
    const campRes = await client.query(
      'SELECT * FROM tracking_campaigns WHERE slug = $1 AND enabled = true AND archived_at IS NULL',
      [slug]
    );
    const campaign = campRes.rows[0];
    if (!campaign) {
      client.release();
      return res.status(404).json({ error: 'Campanha não encontrada ou desativada.' });
    }

    const origin = req.headers.origin || req.headers.referer || '';
    if (!dominioPermitido(campaign, origin)) {
      client.release();
      return res.status(403).json({ error: 'Domínio não autorizado para esta campanha.' });
    }

    await client.query('BEGIN');

    const destino = await selecionarDestino(client, campaign);
    if (!destino) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(503).json({ error: 'Nenhum número de WhatsApp disponível nesta campanha.' });
    }

    const trackingId = await gerarTrackingIdUnico(client);
    const ip = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const clean = (v, max = 255) => String(v || '').trim().slice(0, max) || null;
    const pageUrl = clean(body.page_url, 2000);
    const referrer = clean(body.referrer, 2000) || pageUrl;
    const visitorId = clean(body.visitor_id, 60);
    const geo = await lookupGeoIp(req, ip);

    const utm_source   = clean(body.utm_source   || campaign.utm_source);
    const utm_medium   = clean(body.utm_medium   || campaign.utm_medium);
    const utm_campaign = clean(body.utm_campaign || campaign.utm_campaign);
    const utm_content  = clean(body.utm_content  || campaign.utm_content);

    const fbclid = clean(body.fbclid, 512);
    const fbc = fbclid ? `fb.1.${Date.now()}.${fbclid}` : clean(body.fbc, 512);
    const fbp = clean(body.fbp, 255);

    const placement      = clean(body.placement, 120);
    const ad_id          = clean(body.ad_id, 64);
    const adset_id       = clean(body.adset_id, 64);
    const metaCampaignId = clean(body.meta_campaign_id, 64);
    const gclid          = clean(body.gclid, 512);
    const googleAdsKeyword = clean(body.keyword || body.utm_term, 255);

    await client.query(
      `INSERT INTO tracking_clicks
        (tracking_id, campaign_id, destination_id, cliente_id, status,
         utm_source, utm_medium, utm_campaign, utm_content, referrer, ip_address, user_agent,
         whatsapp_number, instance_name, fbclid, fbc, fbp, event_source_url,
         geo_city, geo_region, geo_region_code, geo_country, geo_country_code,
         placement, ad_id, adset_id, meta_campaign_id, gclid, google_ads_keyword, visitor_id, source, expires_at)
       VALUES ($1,$2,$3,$4,'clicked',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'site', NOW() + INTERVAL '72 hours')`,
      [trackingId, campaign.id, destino.id, campaign.cliente_id,
       utm_source, utm_medium, utm_campaign, utm_content, referrer, ip, userAgent,
       destino.whatsapp_number, destino.instance_name, fbclid, fbc, fbp, pageUrl,
       geo?.city || null, geo?.region || null, geo?.region_code || null,
       geo?.country || null, geo?.country_code || null,
       placement, ad_id, adset_id, metaCampaignId, gclid, googleAdsKeyword, visitorId]
    );

    await client.query('COMMIT');

    await gravarLog(pool, {
      cliente_id: campaign.cliente_id, tag: 'site_whatsapp_click', level: 'info',
      message: `Clique no botão do site (campanha "${campaign.name}") → ${destino.whatsapp_number}`,
      data: { tracking_id: trackingId, visitor_id: visitorId, page_url: pageUrl, fbclid: !!fbclid },
    });

    // A mensagem vem EXCLUSIVAMENTE do campo configurado no painel
    // (campaign.default_message). Ignora o data-wapp-message do botão HTML e não
    // tem fallback fixo — o painel é a única fonte da verdade. Se o cliente deixar
    // vazio, o WhatsApp abre sem texto pré-preenchido.
    const messageTemplate = campaign.default_message || '';
    const baseMsg = formatarMensagemDinamica(messageTemplate, { utm_source, utm_medium, utm_campaign, utm_content });
    const mensagem = inserirTokenNaMensagem(baseMsg, encodeToken(trackingId));
    const numero = (destino.whatsapp_number || '').replace(/\D/g, '');
    const waUrl = `https://api.whatsapp.com/send/?phone=${numero}&text=${encodeURIComponent(mensagem)}&type=phone_number&app_absent=0`;

    return res.status(200).json({ url: waUrl, tracking_id: trackingId });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[site-whatsapp-click]', err.message);
    await gravarLog(pool, { tag: 'site_whatsapp_click', level: 'error', message: `Erro: ${err.message}`, data: { slug } });
    return res.status(500).json({ error: 'Erro ao processar o clique.' });
  } finally {
    client.release();
  }
}
