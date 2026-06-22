/**
 * Envio CENTRALIZADO de conversões para a Meta CAPI (Jornada de conversões, Fase 1).
 *
 * Unifica o que antes estava duplicado em webhook-evo.js (LeadSubmitted),
 * leads-update.js (Purchase/QualifiedLead) e _capi-web.js (Lead web). Uma única
 * função `enviarConversao` decide o canal, monta o user_data correto, usa um
 * event_id determinístico (dedup da Meta) e registra o resultado.
 *
 * Dois canais:
 *  - business_messaging (CTWA/WhatsApp): lead tem ctwa_clid. user_data com
 *    ctwa_clid (cru) + page_id (cru, via resolvePageId) + dados hasheados.
 *    NUNCA client_ip_address/client_user_agent (Meta rejeita — subcode 2804064).
 *    Credenciais: clientes.pixel_padrao + token_meta_enc.
 *  - website (link rastreável): lead sem ctwa_clid, com fbc/fbp do clique.
 *    user_data com fbc/fbp/client_ip_address/client_user_agent + ph hasheado.
 *    Credenciais: clientes.capi_pixel_id + capi_token_enc.
 *
 * Graph API v25 (igual ao restante do projeto). Best-effort: nunca lança.
 */
import crypto from 'crypto';
import { decryptToken } from './_crypto.js';

const GRAPH = 'https://graph.facebook.com/v25.0';

// Mapa conceito → nome real do evento por canal.
const EVENT_NAME = {
  business_messaging: {
    lead: 'LeadSubmitted', qualified: 'QualifiedLead', appointment: 'AppointmentBooked',
    checkout: 'InitiateCheckout', purchase: 'Purchase',
  },
  website: {
    lead: 'Lead', qualified: 'QualifiedLead', appointment: 'Schedule',
    checkout: 'InitiateCheckout', purchase: 'Purchase',
  },
};

// Conceitos que carregam valor monetário (custom_data com value/currency).
const COM_VALOR = new Set(['purchase', 'checkout']);

function hash(str) {
  return /^[a-f0-9]{64}$/.test(str)
    ? str
    : crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');
}

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// page_id é obrigatório no business_messaging; fallback p/ o page_id dominante do cliente.
async function resolvePageId(pool, lead) {
  if (lead.page_id) return lead.page_id;
  if (!lead.cliente_id) return null;
  try {
    const r = await pool.query(
      `SELECT page_id FROM leads_tracking
       WHERE cliente_id = $1 AND page_id IS NOT NULL AND page_id <> ''
       GROUP BY page_id ORDER BY COUNT(*) DESC LIMIT 1`,
      [lead.cliente_id]
    );
    return r.rows[0]?.page_id || null;
  } catch { return null; }
}

async function gravarLogCapi(pool, lead, tag, level, message, data) {
  try {
    await pool.query(
      `INSERT INTO webhook_logs (cliente_id, instance, tag, level, message, data)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [lead.cliente_id || null, lead.instancia || null, tag, level, message, JSON.stringify(data || {})]
    );
  } catch (e) { console.error('Falha ao gravar log CAPI:', e.message); }
}

// Decide o canal: lead com ctwa_clid → business_messaging; senão → website (link).
export function resolverCanal(lead) {
  return lead.ctw_aci_id ? 'business_messaging' : 'website';
}

// event_id determinístico por lead+CONCEITO → a Meta deduplica reenvios, e o
// disparo MANUAL (painel) e o AUTOMÁTICO (webhook) do mesmo conceito geram o
// MESMO event_id (não duplicam o evento na Meta, mesmo vindo de caminhos diferentes).
export function gerarEventId(leadId, concept) {
  return `j_${leadId}_${concept}`;
}

// Busca credenciais do cliente conforme o canal.
async function carregarCredenciais(pool, cliente_id, canal) {
  const r = await pool.query(
    `SELECT pixel_padrao, token_meta, token_meta_enc,
            capi_pixel_id, capi_token_enc
     FROM clientes WHERE id = $1`,
    [cliente_id]
  );
  const row = r.rows[0] || {};
  if (canal === 'website') {
    let token = null;
    if (row.capi_token_enc) { try { token = decryptToken(row.capi_token_enc); } catch {} }
    return { pixel: row.capi_pixel_id || null, token };
  }
  // business_messaging
  let token = row.token_meta || process.env.META_ADS_TOKEN || null;
  if (row.token_meta_enc) { try { token = decryptToken(row.token_meta_enc); } catch {} }
  return { pixel: row.pixel_padrao || null, token };
}

/**
 * Envia uma conversão da jornada à Meta e grava o resultado em lead_journey_history.
 *
 * @param {object} opts
 * @param {object} opts.lead   linha de leads_tracking (id, cliente_id, telefone, ctw_aci_id, page_id,
 *                             email, cpf, cidade, estado, nome, instancia, e — p/ web — fbc/fbp/ip/ua/url)
 * @param {string} opts.concept lead|qualified|appointment|checkout|purchase
 * @param {number} [opts.value] valor (para purchase/checkout)
 * @param {string} [opts.currency='BRL']
 * @param {object} opts.pool
 * @returns {{sent:boolean, error?:string, fbtrace_id?:string, event_id:string, channel:string, event_name:string}}
 */
export async function enviarConversao({ lead, concept, value, currency = 'BRL', pool }) {
  const channel = resolverCanal(lead);
  const event_name = EVENT_NAME[channel]?.[concept];
  const event_id = gerarEventId(lead.id, concept); // por lead+conceito (dedup manual↔automático)
  const base = { sent: false, event_id, channel, event_name };

  if (!event_name) return { ...base, error: `Conceito de evento inválido: ${concept}` };

  const { pixel, token } = await carregarCredenciais(pool, lead.cliente_id, channel);
  if (!pixel || !token) {
    const motivo = !pixel ? 'Pixel não configurado' : 'Token da Meta não configurado';
    await gravarLogCapi(pool, lead, 'capi', 'error', `${event_name} não enviado: ${motivo}`, { lead_id: lead.id, channel });
    return { ...base, error: motivo };
  }

  const ph = (lead.telefone || '').replace(/\D/g, '');
  const nomeParts = (lead.nome || '').trim().split(/\s+/);
  const userData = {};

  if (channel === 'business_messaging') {
    const finalPageId = await resolvePageId(pool, lead);
    if (!finalPageId) {
      await gravarLogCapi(pool, lead, 'capi', 'error', `${event_name} não enviado: page_id ausente`, { lead_id: lead.id });
      return { ...base, error: 'page_id ausente — anúncio sem página identificada' };
    }
    if (lead.ctw_aci_id) userData.ctwa_clid = lead.ctw_aci_id; // cru
    userData.page_id = finalPageId;                            // cru
    if (ph) userData.ph = [hash(ph)];
  } else {
    // website: fbc/fbp/ip/ua crus (contexto web). Sem page_id/ctwa_clid.
    if (lead.fbc) userData.fbc = lead.fbc;
    if (lead.fbp) userData.fbp = lead.fbp;
    if (lead.ip_address) userData.client_ip_address = lead.ip_address;
    if (lead.user_agent) userData.client_user_agent = lead.user_agent;
    if (ph) userData.ph = [hash(ph)];
  }

  // Advanced matching (hasheado) — vale para os dois canais.
  if (lead.email)   userData.em          = [hash(lead.email)];
  if (nomeParts[0]) userData.fn          = [hash(nomeParts[0])];
  if (nomeParts[1]) userData.ln          = [hash(nomeParts.slice(1).join(' '))];
  if (lead.cpf)     userData.external_id = [hash(lead.cpf.replace(/\D/g, ''))];
  if (lead.cidade)  userData.ct          = [hash(lead.cidade)];
  if (lead.estado)  userData.st          = [hash(lead.estado)];
  userData.country = [hash('br')];

  const evento = {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id,                       // dedup determinístico
    action_source: channel,
    user_data: userData,
  };
  if (channel === 'business_messaging') evento.messaging_channel = 'whatsapp';
  if (channel === 'website' && (lead.event_source_url || lead.referrer)) {
    evento.event_source_url = lead.event_source_url || lead.referrer;
  }
  if (COM_VALOR.has(concept)) {
    evento.custom_data = { currency: currency || 'BRL', value: parseFloat(value || 0) };
    if (lead.produto) evento.custom_data.content_name = lead.produto;
  }

  try {
    const r = await fetchWithTimeout(`${GRAPH}/${pixel}/events?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [evento] }),
    });
    const resp = await r.json();
    if (resp.events_received) {
      await gravarLogCapi(pool, lead, 'capi', 'info', `${event_name} enviado (${channel}).`,
        { lead_id: lead.id, event_id, fbtrace_id: resp.fbtrace_id });
      return { ...base, sent: true, fbtrace_id: resp.fbtrace_id };
    }
    const msg = resp.error?.message || 'Evento rejeitado pela Meta';
    await gravarLogCapi(pool, lead, 'capi', 'error', `${event_name} rejeitado: ${msg}`,
      { lead_id: lead.id, event_id, meta_error: resp.error || resp });
    return { ...base, error: msg };
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout ao contatar a Meta' : err.message;
    await gravarLogCapi(pool, lead, 'capi', 'error', `${event_name} erro: ${msg}`, { lead_id: lead.id, event_id });
    return { ...base, error: msg };
  }
}

/**
 * Extrai um valor monetário (R$ 1.250,90 → 1250.90) usando um regex configurável
 * com grupo nomeado `value`. Roda com guard de tempo/tamanho para não travar o
 * webhook com regex maliciosa. Retorna número ou null.
 */
export function extrairValor(texto, regexStr) {
  if (!texto || !regexStr) return null;
  // Guard de tamanho: regex sobre texto curto; mensagens são pequenas.
  const alvo = String(texto).slice(0, 500);
  let re;
  try { re = new RegExp(regexStr, 'i'); } catch { return null; }
  let m;
  try { m = re.exec(alvo); } catch { return null; }
  const bruto = m?.groups?.value || m?.[1];
  if (!bruto) return null;
  // Normaliza formato BR: 1.250,90 → 1250.90 ; 500,00 → 500.00 ; 500 → 500
  const limpo = String(bruto).replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

export default enviarConversao;
