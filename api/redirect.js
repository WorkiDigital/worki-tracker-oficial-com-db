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
import crypto from 'crypto';

function gerarTrackingId() {
  // 10 chars base64url (~60 bits), tamanho fixo e seguro para o índice UNIQUE.
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
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

  await ensureTrackingSchema();
  const pool = getPool();
  const client = await pool.connect();
  try {
    // 1. Campanha ativa
    const campRes = await client.query(
      'SELECT * FROM tracking_campaigns WHERE slug = $1 AND enabled = true',
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
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || '';
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

    await client.query(
      `INSERT INTO tracking_clicks
        (tracking_id, campaign_id, destination_id, cliente_id, status,
         utm_source, utm_medium, utm_campaign, utm_content, referrer, ip_address, user_agent,
         whatsapp_number, instance_name, fbclid, fbc, fbp, pageview_event_id, expires_at)
       VALUES ($1,$2,$3,$4,'clicked',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW() + INTERVAL '72 hours')`,
      [trackingId, campaign.id, destino.id, campaign.cliente_id,
       utm_source, utm_medium, utm_campaign, utm_content, referrer, ip, userAgent,
       destino.whatsapp_number, destino.instance_name, fbclid, fbc, fbp, pageviewEventId]
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
              fbclid: !!fbclid, fbc: !!fbc, fbp: !!fbp, capi_pixel: !!capiPixelId },
    });

    // PageView server-side (CAPI) com o MESMO event_id do Pixel → Meta deduplica.
    // Best-effort: não bloqueia o redirect, mas loga e grava o status no clique.
    if (capiPixelId) {
      enviarCapiWebPageView(pool, {
        cliente_id: campaign.cliente_id,
        eventId: pageviewEventId,
        click: { fbc, fbp, ip_address: ip, user_agent: userAgent,
                 referrer, event_source_url: `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host || ''}/r/${slug}` },
      }).then(async r => {
        // Grava o status no clique (consistência com o log) — 'pv_sent' distingue
        // o PageView do clique do 'sent' do Lead que vem depois pelo webhook.
        try {
          await pool.query('UPDATE tracking_clicks SET capi_web_status=$1 WHERE tracking_id=$2',
            [r.sent ? 'pv_sent' : 'pv_failed', trackingId]);
        } catch (_) {}
        await gravarLog(pool, {
          cliente_id: campaign.cliente_id, instance: `link:${slug}`,
          tag: 'capi_web', level: r.sent ? 'info' : 'warn',
          message: r.sent ? 'CAPI Web PageView enviado (clique).' : `CAPI Web PageView falhou: ${r.error}`,
          data: { tracking_id: trackingId, event_id: pageviewEventId, fbtrace_id: r.fbtrace_id, error: r.error },
        });
      }).catch(() => {});
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

    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('');
    }
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
