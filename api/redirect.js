/**
 * Redirecionador público de link rastreável:
 * GET /redirect/<uuid> (atual) ou GET /r/<slug> (compatibilidade)
 *
 * Fluxo:
 *  1. Acha a campanha ativa pelo slug
 *  2. Seleciona um destino (rotador, transacional)
 *  3. Gera um tracking_id e registra o clique (UTMs, referrer, IP, user-agent)
 *  4. Codifica o tracking_id num token invisível na mensagem
 *  5. Responde 302 para api.whatsapp.com/send com a mensagem pronta
 *
 * Rota pública (sem auth). O server.js encaminha o identificador em
 * req.query.slug e informa a rota usada em req.query.public_path.
 */
import { getPool } from './_db.js';
import { selecionarDestino } from './_rotator.js';
import { encodeToken } from './_invisible-token.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { enviarCapiWebPageView } from './_capi-web.js';
import { extractClientIp, lookupGeoIp } from './_geoip.js';
import crypto from 'crypto';

function gerarTrackingId() {
  // 4 bytes = 32 caracteres invisíveis no WhatsApp. O valor hexadecimal fica
  // armazenado no banco e é recuperado exatamente pelo decoder do webhook.
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function gerarTrackingIdUnico(client) {
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const trackingId = gerarTrackingId();
    const existe = await client.query(
      'SELECT 1 FROM tracking_clicks WHERE tracking_id=$1 LIMIT 1',
      [trackingId]
    );
    if (!existe.rows.length) return trackingId;
  }
  throw new Error('Não foi possível gerar um identificador único para o clique.');
}

function inserirTokenNaMensagem(texto, token) {
  const mensagem = String(texto || '');
  if (!token) return mensagem;

  // Insere dentro da primeira palavra com pelo menos 4 letras. Manter o bloco
  // cercado por texto reduz a chance de o WhatsApp tratá-lo como espaço isolado.
  const palavra = /[\p{L}\p{N}]{4,}/u.exec(mensagem);
  if (!palavra) return token + mensagem;
  const ponto = palavra.index + Math.max(2, Math.floor(palavra[0].length / 2));
  return mensagem.slice(0, ponto) + token + mensagem.slice(ponto);
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
// Escapa texto para uso seguro dentro do HTML (evita quebra/injeção via título/subtítulo).
function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Só aceita cor num formato seguro (#hex, rgb/rgba, ou nome CSS simples) para
// injetar em CSS inline. Qualquer coisa fora disso cai no padrão escuro.
function corSegura(cor, fallback) {
  const c = String(cor || '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c;
  if (/^rgba?\(\s*[\d.,\s%]+\)$/i.test(c)) return c;
  if (/^[a-z]{3,20}$/i.test(c)) return c; // nomes CSS (white, beige, etc.)
  return fallback;
}

function htmlPagePixel({ waUrl, pixelId, eventId, fbc, fbp, googleAdsId, googleAdsLabel, gclid, gbraid, wbraid, redirectTitle, redirectSubtitle, redirectBgColor }) {
  const safeUrl = waUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const bgColor = corSegura(redirectBgColor, '#e5ddd5');
  // Título/subtítulo: usa os configurados, senão os padrões. Escapados p/ HTML.
  const titulo = escHtml(redirectTitle || 'Redirecionando para o WhatsApp…');
  const subtitulo = redirectSubtitle != null && String(redirectSubtitle).trim() !== ''
    ? escHtml(redirectSubtitle) : '';
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
  // Google Ads (conversão via clique) — 100% client-side (gtag.js), sem GTM. Só
  // dispara quando o cliente tem o ID/label configurados E o clique veio com
  // gclid, gbraid ou wbraid (senão não há anúncio Google para atribuir). gbraid/
  // wbraid cobrem fluxos sem cookie de terceiros (iOS/Safari, Performance Max),
  // onde o Google não entrega gclid.
  const temIdentificadorGoogle = !!(gclid || gbraid || wbraid);
  const conversionExtra = !gclid
    ? `${gbraid ? `,\n        'gbraid': ${jsStr(gbraid)}` : ''}${wbraid ? `,\n        'wbraid': ${jsStr(wbraid)}` : ''}`
    : '';
  const gtagSnippet = (googleAdsId && googleAdsLabel && temIdentificadorGoogle) ? `
  <script async src="https://www.googletagmanager.com/gtag/js?id=${jsStr(googleAdsId)}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', ${jsStr(googleAdsId)});
    try {
      gtag('event', 'conversion', {
        'send_to': ${jsStr(googleAdsId + '/' + googleAdsLabel)},
        'value': 1.0,
        'currency': 'BRL'${conversionExtra}
      });
    } catch(e) {}
  </script>` : '';
  const delayMs = (pixelId || gtagSnippet) ? 1400 : 300;
  return `<!DOCTYPE html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Redirecionando…</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:${bgColor};height:100vh;display:flex;align-items:center;
    justify-content:center;padding:20px}
  .card{background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.12);
    padding:38px 44px;max-width:440px;width:100%;text-align:center;
    display:flex;flex-direction:column;align-items:center;gap:14px}
  .spin{width:40px;height:40px;border:4px solid rgba(18,140,126,.18);
    border-top-color:#128c7e;border-radius:50%;animation:r .8s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
  h1{font-size:19px;font-weight:700;color:#128c7e;line-height:1.3;margin-top:6px}
  p{font-size:14px;color:#667781;line-height:1.4}
  a{color:#128c7e;text-decoration:none;font-size:13px;font-weight:600;margin-top:4px}
</style></head>
<body>
  <div class="card">
    <div class="spin"></div>
    <h1>${titulo}</h1>
    ${subtitulo ? `<p>${subtitulo}</p>` : ''}
    <a id="manual" href="${safeUrl}">Abrir agora</a>
  </div>
  ${pixelSnippet}
  ${gtagSnippet}
  <script>
    var dest = ${jsStr(waUrl)};
    // Delay curto para o Pixel/gtag disparar antes de sair da página.
    setTimeout(function(){ window.location.replace(dest); }, ${delayMs});
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
    const trackingId = await gerarTrackingIdUnico(client);
    const ip = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || '';
    const publicPath = req.query.public_path === 'redirect' ? 'redirect' : 'r';
    const eventSourceUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host || ''}/${publicPath}/${slug}`;
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
    // gbraid/wbraid: identificadores de clique do Google Ads para fluxos sem
    // cookie de terceiros (iOS/Safari, campanhas Performance Max) — paridade com
    // gclid, que já era capturado.
    const gbraid         = adParam(q.gbraid, 512);
    const wbraid         = adParam(q.wbraid, 512);
    // Palavra-chave do Google Ads: variável dinâmica {keyword} do próprio Google.
    // Aceita nomes alternativos (keyword, utm_term) para robustez.
    const googleAdsKeyword = adParam(q.keyword || q.utm_term, 255);

    // Teste de rastreamento do wizard de onboarding: confirma que o link
    // resolve/tem destino disponível sem gravar um clique falso nas métricas
    // reais do cliente. Único desvio — resto da validação roda normalmente.
    const isOnboardingTest = req.headers['x-onboarding-test'] === '1';
    if (!isOnboardingTest) {
      await client.query(
        `INSERT INTO tracking_clicks
          (tracking_id, campaign_id, destination_id, cliente_id, status,
           utm_source, utm_medium, utm_campaign, utm_content, referrer, ip_address, user_agent,
           whatsapp_number, instance_name, fbclid, fbc, fbp, pageview_event_id, event_source_url,
           geo_city, geo_region, geo_region_code, geo_country, geo_country_code,
           placement, ad_id, adset_id, meta_campaign_id, gclid, google_ads_keyword, expires_at,
           gbraid, wbraid)
         VALUES ($1,$2,$3,$4,'clicked',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29, NOW() + INTERVAL '72 hours',$30,$31)`,
        [trackingId, campaign.id, destino.id, campaign.cliente_id,
         utm_source, utm_medium, utm_campaign, utm_content, referrer, ip, userAgent,
         destino.whatsapp_number, destino.instance_name, fbclid, fbc, fbp, pageviewEventId, eventSourceUrl,
         geo?.city || null, geo?.region || null, geo?.region_code || null,
         geo?.country || null, geo?.country_code || null,
         placement, ad_id, adset_id, metaCampaignId, gclid, googleAdsKeyword,
         gbraid, wbraid]
      );
    }

    await client.query('COMMIT');

    if (isOnboardingTest) {
      // Encerra aqui: nada de CAPI/Pixel/logs para um teste sintético.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, destino: destino.whatsapp_number }));
    }

    // Busca o pixel CAPI Web e as credenciais de Google Ads do cliente (uma única
    // consulta, reaproveitada tanto pro Pixel JS/CAPI server quanto pro gtag.js).
    let capiPixelId = null;
    let googleAdsId = null;
    let googleAdsLabel = null;
    try {
      const cli = await pool.query(
        'SELECT capi_pixel_id, google_ads_conversion_id, google_ads_conversion_label FROM clientes WHERE id = $1',
        [campaign.cliente_id]
      );
      capiPixelId = cli.rows[0]?.capi_pixel_id || null;
      googleAdsId = cli.rows[0]?.google_ads_conversion_id || null;
      googleAdsLabel = cli.rows[0]?.google_ads_conversion_label || null;
    } catch (_) {}

    // Log do clique (sempre) — visível na aba Logs do Sistema.
    await gravarLog(pool, {
      cliente_id: campaign.cliente_id, instance: `link:${slug}`,
      tag: 'tracking_click', level: 'info',
      message: `Clique no link "${campaign.name}" → ${destino.whatsapp_number}`,
      data: { tracking_id: trackingId, campaign_id: campaign.id, destino: destino.whatsapp_number,
              fbclid: !!fbclid, fbc: !!fbc, fbp: !!fbp, capi_pixel: !!capiPixelId,
              gclid: !!gclid, gbraid: !!gbraid, wbraid: !!wbraid, google_ads_keyword: googleAdsKeyword,
              google_ads_configurado: !!(googleAdsId && googleAdsLabel),
              geo_city: geo?.city || null, geo_region: geo?.region || null,
              geo_country: geo?.country || null },
    });

    // Log dedicado do disparo Google Ads (paridade com o log capi_web da Meta) —
    // best-effort, só quando o snippet realmente foi/seria injetado. gbraid/wbraid
    // contam como identificador válido (fluxos sem gclid, ex. iOS/Safari).
    const temIdentificadorGoogleLog = !!(gclid || gbraid || wbraid);
    if (temIdentificadorGoogleLog && googleAdsId && googleAdsLabel) {
      await gravarLog(pool, {
        cliente_id: campaign.cliente_id, instance: `link:${slug}`,
        tag: 'google_ads_click', level: 'info',
        message: `Conversão Google Ads disparada (client-side) no clique.`,
        data: { tracking_id: trackingId, google_ads_conversion_id: googleAdsId,
                via: gclid ? 'gclid' : (gbraid ? 'gbraid' : 'wbraid') },
      });
    } else if (temIdentificadorGoogleLog && (!googleAdsId || !googleAdsLabel)) {
      await gravarLog(pool, {
        cliente_id: campaign.cliente_id, instance: `link:${slug}`,
        tag: 'google_ads_click', level: 'warn',
        message: `Clique com identificador Google (gclid/gbraid/wbraid) mas cliente sem ID/label de conversão configurado.`,
        data: { tracking_id: trackingId },
      });
    }

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
    // A mensagem vem EXCLUSIVAMENTE do campo configurado no painel
    // (campaign.default_message). Sem fallback: se o cliente deixar vazio, o
    // WhatsApp abre sem texto pré-preenchido. Decisão do usuário — o painel é a
    // única fonte da verdade da mensagem.
    const messageTemplate = campaign.default_message || '';
    const baseMsg = formatarMensagemDinamica(messageTemplate, {
      utm_source, utm_medium, utm_campaign, utm_content,
    });
    const mensagem = inserirTokenNaMensagem(baseMsg, encodeToken(trackingId));

    // 5. Página intermediária com Pixel (PageView no navegador) + redireciona.
    // Se houver pixel CAPI Web, serve a página com Pixel e delay curto para o
    // PageView disparar (dedup via event_id com o CAPI server). Sem pixel,
    // mantém o redirect rápido (delay mínimo).
    const numero = (destino.whatsapp_number || '').replace(/\D/g, '');
    const waUrl = `https://api.whatsapp.com/send/?phone=${numero}&text=${encodeURIComponent(mensagem)}&type=phone_number&app_absent=0`;

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    return res.end(htmlPagePixel({
      waUrl, pixelId: capiPixelId, eventId: pageviewEventId, fbc, fbp,
      googleAdsId, googleAdsLabel, gclid, gbraid, wbraid,
      redirectTitle: campaign.redirect_title,
      redirectSubtitle: campaign.redirect_subtitle,
      redirectBgColor: campaign.redirect_bg_color,
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
