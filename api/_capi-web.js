/**
 * CAPI Web — envia evento de conversão atribuído à CAMPANHA do Facebook
 * (canal website), distinto do business_messaging do WhatsApp/CTWA.
 *
 * Quando um lead chega por um link rastreável que veio de um anúncio do FB,
 * o clique guardou o `fbc` (derivado do fbclid). Aqui disparamos o evento `Lead`
 * com action_source=website + fbc/fbp para a Meta atribuir à campanha.
 *
 * Usa o PIXEL + TOKEN DEDICADOS de CAPI (clientes.capi_pixel_id / capi_token_enc),
 * que é o token gerado em Eventos Manager > Conjuntos de Dados > Conversions API —
 * diferente do token_meta (App) usado no canal de WhatsApp.
 */
import crypto from 'crypto';
import { decryptToken } from './_crypto.js';

const GRAPH_VER = 'v25.0';

const hash = (str) => {
  const s = (str || '').toLowerCase().trim();
  if (!s) return null;
  return /^[a-f0-9]{64}$/.test(s) ? s : crypto.createHash('sha256').update(s).digest('hex');
};

/**
 * Dispara o evento `Lead` (website) para a Meta.
 * @returns {Promise<{sent:boolean, error?:string}>}
 */
export async function enviarCapiWebLead(pool, { cliente_id, click, lead }) {
  // Precisa de fbc (atribuição de anúncio) — sem ele não há o que atribuir.
  if (!click?.fbc) return { sent: false, error: 'sem fbc (lead não veio de anúncio web)' };

  // Token + pixel DEDICADOS de CAPI web.
  const cliRes = await pool.query(
    'SELECT capi_pixel_id, capi_token_enc FROM clientes WHERE id = $1',
    [cliente_id]
  );
  const row = cliRes.rows[0];
  if (!row?.capi_pixel_id || !row?.capi_token_enc) {
    return { sent: false, error: 'cliente sem pixel/token CAPI web configurado' };
  }
  let token;
  try { token = decryptToken(row.capi_token_enc); }
  catch (e) { return { sent: false, error: 'falha ao descriptografar token CAPI web' }; }

  // user_data do canal website: fbc/fbp (não hasheados) + ph (hasheado).
  const ph = (lead.telefone || '').replace(/\D/g, '');
  const userData = {};
  if (click.fbc) userData.fbc = click.fbc;
  if (click.fbp) userData.fbp = click.fbp;
  if (ph) userData.ph = [hash(ph)];
  if (click.ip_address)  userData.client_ip_address  = click.ip_address;
  if (click.user_agent)  userData.client_user_agent  = click.user_agent;

  const payload = {
    data: [{
      event_name:      'Lead',
      event_time:      Math.floor(Date.now() / 1000),
      action_source:   'website',
      event_source_url: click.referrer || undefined,
      user_data:       userData,
      custom_data: {
        ...(click.utm_campaign ? { campaign: click.utm_campaign } : {}),
      },
    }]
  };

  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VER}/${row.capi_pixel_id}/events?access_token=${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const resp = await r.json();
    if (resp.events_received) {
      return { sent: true, fbtrace_id: resp.fbtrace_id };
    }
    return { sent: false, error: resp.error?.message || JSON.stringify(resp) };
  } catch (err) {
    return { sent: false, error: err.message || String(err) };
  }
}
