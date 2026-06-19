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
import crypto from 'crypto';

function gerarTrackingId() {
  // 9 chars base62 — curto o suficiente para o token invisível não ficar gigante.
  return crypto.randomBytes(7).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 9);
}

function htmlRedirect(url) {
  // Fallback HTML caso o 302 seja bloqueado; também evita preview de link quebrar.
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${url.replace(/"/g, '&quot;')}">
<title>Redirecionando…</title></head>
<body>Redirecionando para o WhatsApp… <a href="${url.replace(/"/g, '&quot;')}">clique aqui</a> se não for automático.</body></html>`;
}

export default async function handler(req, res) {
  const slug = (req.query.slug || '').trim();
  if (!slug) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Link inválido.');
  }

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
    const utm_source   = q.utm_source   || campaign.utm_source   || null;
    const utm_medium   = q.utm_medium   || campaign.utm_medium   || null;
    const utm_campaign = q.utm_campaign || campaign.utm_campaign || null;

    await client.query(
      `INSERT INTO tracking_clicks
        (tracking_id, campaign_id, destination_id, cliente_id, status,
         utm_source, utm_medium, utm_campaign, referrer, ip_address, user_agent,
         whatsapp_number, expires_at)
       VALUES ($1,$2,$3,$4,'clicked',$5,$6,$7,$8,$9,$10,$11, NOW() + INTERVAL '72 hours')`,
      [trackingId, campaign.id, destino.id, campaign.cliente_id,
       utm_source, utm_medium, utm_campaign, referrer, ip, userAgent,
       destino.whatsapp_number]
    );

    await client.query('COMMIT');

    // 4. Mensagem + token invisível
    const baseMsg = campaign.default_message || 'Olá! Gostaria de mais informações.';
    const mensagem = baseMsg + encodeToken(trackingId);

    // 5. Redireciona para o WhatsApp
    const numero = (destino.whatsapp_number || '').replace(/\D/g, '');
    const waUrl = `https://api.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(mensagem)}`;

    res.writeHead(302, { 'Location': waUrl, 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(htmlRedirect(waUrl));

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[redirect]', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Erro ao processar o link.');
  } finally {
    client.release();
  }
}
