/**
 * Redirecionador público de link rastreável: GET /r/<slug>
 *
 * Fluxo:
 *  1. Acha a campanha ativa pelo slug
 *  2. Seleciona um destino (rotador, transacional)
 *  3. Gera um tracking_id e registra o clique (UTMs, referrer, IP, user-agent)
 *  4. Codifica o tracking_id num token invisível na mensagem
 *  5. Responde 302 para api.whatsapp.com/send com a mensagem pronta
 *
 * Rota pública (sem auth). O server.js encaminha /r/<slug> para cá com
 * req.query.slug preenchido, e aplica rate limit antes.
 */
import { getPool } from './_db.js';
import { selecionarDestino } from './_rotator.js';
import { encodeToken } from './_invisible-token.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { enviarCapiWebPageView } from './_capi-web.js';
import { extractClientIp, lookupGeoIp } from './_geoip.js';
import crypto from 'crypto';

function gerarTrackingId() {
  // 7 chars base64url (~42 bits, ~4 trilhões de combinações): entropia de sobra e
  // o índice UNIQUE pega qualquer colisão. Menor = token invisível mais curto na
  // mensagem (cada char do ID vira ~4 caracteres invisíveis no token base-4).
  return crypto.randomBytes(6).toString('base64url').slice(0, 7);
}

const PREVIEW_BOT_RE = /(bot|crawler|spider|preview|facebookexternalhit|facebot|whatsapp|telegrambot|slackbot|discordbot|linkedinbot|twitterbot|googlebot|bingbot)/i;

function isPreviewBot(userAgent) {
  return PREVIEW_BOT_RE.test(String(userAgent || ''));
}

function responderPreview(res, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  return res.end(status === 200
    ? '<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Link para WhatsApp</title></head><body></body></html>'
    : '');
}

// Lê um cookie pelo nome do header Cookie (ex: _fbp do Pixel da Meta).
function lerCookie(cookieHeader, nome) {
  if (!cookieHeader) return null;
  for (const par of cookieHeader.split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nome) return v.join('=') || null;
  }
  return null;
}

const jsStr = (s) => JSON.stringify(String(s ?? ''));

export function formatarMensagemDinamica(template, utms = {}) {
  const valores = {
    utm_source: utms.utm_source,
    utm_medium: utms.utm_medium,
    utm_campaign: utms.utm_campaign,
    utm_content: utms.utm_content,
  };
  let mensagem = String(template || '');
  for (const [chave, valor] of Object.entries(valores)) {
    mensagem = mensagem.replace(
      new RegExp(`{{\\s*${chave}\\s*}}`, 'gi'),
      String(valor || '')
    );
  }
  return mensagem
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .trim();
}

// Grava na tabela webhook_logs (aba Logs do Sistema). Best-effort.
async function gravarLog(pool, { cliente_id, instance, tag, level, message, data }) {
  try {
    await pool.query(
      `INSERT INTO webhook_logs (cliente_id, instance, tag, level, message, data)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [cliente_id || null, instance || 'redirect', tag, level || 'info', message, JSON.stringify(data || {})]
    );
  } catch { /* nunca derruba o redirect */ }
}

// Página intermediária: dispara o Pixel (PageView) no navegador com o mesmo
// event_id do CAPI server-side (dedup), espera ~1.5s e redireciona pro WhatsApp.
// Spinner discreto para o usuário entender que é rápido.
function htmlPagePixel({ waUrl, pixelId, eventId, fbc, fbp }) {
  const safeUrl = waUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const pixelSnippet = pixelId ? `
  <script>
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    try {
      fbq('init', ${jsStr(pixelId)});
      fbq('track', 'PageView', {}, { eventID: ${jsStr(eventId)} });
    } catch(e) {}
  </script>` : '';
  return `<!DOCTYPE html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Redirecionando…</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:#0a0f1a;color:#e2e8f0;height:100vh;display:flex;align-items:center;
    justify-content:center;flex-direction:column;gap:18px}
  .spin{width:42px;height:42px;border:3px solid rgba(255,255,255,.15);
    border-top-color:#25D366;border-radius:50%;animation:r .8s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
  p{font-size:15px;color:#94a3b8}
  a{color:#25D366;text-decoration:none;font-size:13px}
</style></head>
<body>
  <div class="spin"></div>
  <p>Redirecionando para o WhatsApp…</p>
  <a id="manual" href="${safeUrl}">Abrir agora</a>
  ${pixelSnippet}
  <script>
    var dest = ${jsStr(waUrl)};
    // Delay curto para o Pixel disparar o PageView antes de sair da página.
    setTimeout(function(){ window.location.replace(dest); }, ${pixelId ? 1400 : 300});
  </script>
</body></html>`;
}

export default async function handler(req, res) {
  const slug = (req.query.slug || '').trim();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' });
    return res.end('Método não permitido.');
  }
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Link inválido.');
  }

  // HEAD e crawlers de preview nunca representam uma intenção real de abrir o
  // WhatsApp. Eles apenas verificam a URL; não podem criar clique, avançar o
  // rotador nem disparar Pixel/CAPI.
  if (req.method === 'HEAD' || isPreviewBot(req.headers['user-agent'])) {
    try {
      const found = await getPool().query(
        'SELECT 1 FROM tracking_campaigns WHERE slug=$1 AND enabled=true',
        [slug]
      );
      if (!found.rows.length) return responderPreview(res, 404);
      return responderPreview(res, 200);
    } catch (err) {
      console.error('[redirect] falha ao validar preview:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('');
    }
  }

  await ensureTrackingSchema();
  const pool = getPool();
  const client = await pool.connect();
  try {
    // 1. Campanha ativa
    const campRes = await client.query(
      'SELECT * FROM tracking_campaigns WHERE slug = $1 AND enabled = true AND archived_at IS NULL',
      [slug]
    );
    const campaign = campRes.rows[0];
    if (!campaign) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Campanha não encontrada ou desativada.');
    }

    await client.query('BEGIN');

    // 2. Destino (transacional)
    const destino = await selecionarDestino(client, campaign);
    if (!destino) {
      await client.query('ROLLBACK');
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nenhum número de WhatsApp disponível nesta campanha.');
    }

    // 3. Registrar clique
    const trackingId = gerarTrackingId();
    const ip = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || '';
    const eventSourceUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host || ''}/r/${slug}`;
    const geo = await lookupGeoIp(req, ip);
    // UTMs: da query do link (override) ou os da campanha
    const q = req.query || {};
    const utmValue = value => String(value || '').trim().slice(0, 255) || null;
    const utm_source   = utmValue(q.utm_source   || campaign.utm_source);
    const utm_medium   = utmValue(q.utm_medium   || campaign.utm_medium);
    const utm_campaign = utmValue(q.utm_campaign || campaign.utm_campaign);
    const utm_content  = utmValue(q.utm_content  || campaign.utm_content);

    // Atribuição Meta (anúncio web → link): o Facebook anexa ?fbclid=... ao clicar
    // no anúncio. Geramos o fbc no formato oficial fb.1.<ts>.<fbclid> p/ CAPI web.
    // fbp vem do cookie _fbp (se o Pixel já rodou no navegador). Ambos são best-effort:
    // sem eles, segue só o tracking interno.
    const fbclid = q.fbclid || null;
    const fbc = fbclid ? `fb.1.${Date.now()}.${fbclid}` : null;
    const fbp = lerCookie(req.headers.cookie, '_fbp');
    // event_id compartilhado entre o Pixel (navegador) e o CAPI (servidor) → dedup.
    const pageviewEventId = `pv_${trackingId}_${Date.now().toString(36)}`;

    // Parâmetros extras do anúncio (vêm na URL via variáveis dinâmicas da Meta/Google):
    //  placement={{placement}}  ad_id={{ad.id}}  adset_id={{adset.id}}
    //  meta_campaign_id={{campaign.id}}  gclid={gclid} (Google Ads)
    // Aceita nomes alternativos comuns para robustez (ad_name->placement não; só IDs/posição).
    const adParam = (v, max = 120) => String(v || '').trim().slice(0, max) || null;
    const placement      = adParam(q.placement);
    const ad_id          = adParam(q.ad_id || q.adid, 64);
    const adset_id       = adParam(q.adset_id, 64);
    const metaCampaignId = adParam(q.meta_campaign_id || q.campaign_id, 64);
    const gclid          = adParam(q.gclid, 512);

    await client.query(
      `INSERT INTO tracking_clicks
        (tracking_id, campaign_id, destination_id, cliente_id, status,
         utm_source, utm_medium, utm_campaign, utm_content, referrer, ip_address, user_agent,
         whatsapp_number, instance_name, fbclid, fbc, fbp, pageview_event_id, event_source_url,
         geo_city, geo_region, geo_region_code, geo_country, geo_country_code,
         placement, ad_id, adset_id, meta_campaign_id, gclid, expires_at)
       VALUES ($1,$2,$3,$4,'clicked',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28, NOW() + INTERVAL '72 hours')`,
      [trackingId, campaign.id, destino.id, campaign.cliente_id,
       utm_source, utm_medium, utm_campaign, utm_content, referrer, ip, userAgent,
       destino.whatsapp_number, destino.instance_name, fbclid, fbc, fbp, pageviewEventId, eventSourceUrl,
       geo?.city || null, geo?.region || null, geo?.region_code || null,
       geo?.country || null, geo?.country_code || null,
       placement, ad_id, adset_id, metaCampaignId, gclid]
    );

    await client.query('COMMIT');

    // Busca o pixel CAPI Web do cliente (para o Pixel JS no navegador e o CAPI server).
    let capiPixelId = null;
    try {
      const px = await pool.query('SELECT capi_pixel_id FROM clientes WHERE id = $1', [campaign.cliente_id]);
      capiPixelId = px.rows[0]?.capi_pixel_id || null;
    } catch (_) {}

    // Log do clique (sempre) — visível na aba Logs do Sistema.
    await gravarLog(pool, {
      cliente_id: campaign.cliente_id, instance: `link:${slug}`,
      tag: 'tracking_click', level: 'info',
      message: `Clique no link "${campaign.name}" → ${destino.whatsapp_number}`,
      data: { tracking_id: trackingId, campaign_id: campaign.id, destino: destino.whatsapp_number,
              fbclid: !!fbclid, fbc: !!fbc, fbp: !!fbp, capi_pixel: !!capiPixelId,
              geo_city: geo?.city || null, geo_region: geo?.region || null,
              geo_country: geo?.country || null },
    });

    // PageView server-side (CAPI) com o MESMO event_id do Pixel → Meta deduplica.
    // Aguardamos a chamada antes de encerrar o handler para ambientes serverless
    // não cancelarem a Promise assim que a resposta HTTP for enviada.
    if (capiPixelId) {
      const capiPageView = await enviarCapiWebPageView(pool, {
        cliente_id: campaign.cliente_id,
        eventId: pageviewEventId,
        click: { fbc, fbp, ip_address: ip, user_agent: userAgent,
                 referrer, event_source_url: eventSourceUrl },
      });
      try {
        await pool.query('UPDATE tracking_clicks SET capi_web_status=$1 WHERE tracking_id=$2',
          [capiPageView.sent ? 'pv_sent' : 'pv_failed', trackingId]);
      } catch (_) {}
      await gravarLog(pool, {
        cliente_id: campaign.cliente_id, instance: `link:${slug}`,
        tag: 'capi_web', level: capiPageView.sent ? 'info' : 'warn',
        message: capiPageView.sent ? 'CAPI Web PageView enviado (clique).' : `CAPI Web PageView falhou: ${capiPageView.error}`,
        data: { tracking_id: trackingId, event_id: pageviewEventId, fbtrace_id: capiPageView.fbtrace_id, error: capiPageView.error },
      });
    }

    // 4. Mensagem + token invisível
    const messageTemplate = campaign.default_message || 'Olá! Gostaria de mais informações.';
    const baseMsg = formatarMensagemDinamica(messageTemplate, {
      utm_source, utm_medium, utm_campaign, utm_content,
    }) || 'Olá! Gostaria de mais informações.';
    // Token no início: o cursor abre no final da mensagem e alterações comuns no
    // texto visível tendem a preservar o bloco invisível.
    const mensagem = encodeToken(trackingId) + baseMsg;

    // 5. Página intermediária com Pixel (PageView no navegador) + redireciona.
    // Se houver pixel CAPI Web, serve a página com Pixel e delay curto para o
    // PageView disparar (dedup via event_id com o CAPI server). Sem pixel,
    // mantém o redirect rápido (delay mínimo).
    const numero = (destino.whatsapp_number || '').replace(/\D/g, '');
    const waUrl = `https://api.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(mensagem)}`;

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    return res.end(htmlPagePixel({
      waUrl, pixelId: capiPixelId, eventId: pageviewEventId, fbc, fbp,
    }));

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[redirect]', err.message);
    gravarLog(pool, { instance: `link:${slug}`, tag: 'tracking_click', level: 'error',
      message: `Erro no redirecionador: ${err.message}`, data: { slug } });
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Erro ao processar o link.');
  } finally {
    client.release();
  }
}
