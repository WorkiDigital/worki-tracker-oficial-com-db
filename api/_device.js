/**
 * Parser leve de User-Agent — sem libs externas (padrão vanilla do projeto).
 *
 * Extrai dispositivo, sistema operacional e navegador de uma string user-agent
 * crua (gravada em tracking_clicks.user_agent no clique do link). Usado pelo
 * painel para mostrar de qual aparelho veio cada interação do lead.
 *
 * Não pretende ser exaustivo — cobre os casos comuns de tráfego WhatsApp/Meta
 * (iPhone, Android, Desktop) com fallback seguro para `null`.
 */

// Resultado vazio padrão — nunca lança, sempre retorna o shape esperado.
const VAZIO = { device: null, os: null, browser: null, label: null };

export function parseUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return { ...VAZIO };
  const s = ua.toLowerCase();

  // ── Dispositivo + SO ──
  let device = null;
  let os = null;

  if (/\bipad\b/.test(s)) {
    device = 'Tablet'; os = 'iPadOS';
  } else if (/\biphone\b/.test(s) || /\bipod\b/.test(s)) {
    device = 'iPhone'; os = 'iOS';
  } else if (/\bandroid\b/.test(s)) {
    // Tablets Android costumam NÃO trazer "mobile" no UA.
    device = /\bmobile\b/.test(s) ? 'Android' : 'Tablet';
    os = 'Android';
  } else if (/windows nt/.test(s)) {
    device = 'Desktop'; os = 'Windows';
  } else if (/mac os x|macintosh/.test(s)) {
    device = 'Desktop'; os = 'macOS';
  } else if (/\blinux\b/.test(s)) {
    device = 'Desktop'; os = 'Linux';
  } else if (/\bmobile\b/.test(s)) {
    device = 'Mobile';
  }

  // ── Navegador ── (ordem importa: Edge/OPR/Chrome compartilham tokens)
  let browser = null;
  if (/\bfban\b|\bfbav\b|\bfb_iab\b/.test(s)) browser = 'Facebook';
  else if (/instagram/.test(s)) browser = 'Instagram';
  else if (/\bedg(e|a|ios)?\//.test(s)) browser = 'Edge';
  else if (/\bopr\/|\bopera\b/.test(s)) browser = 'Opera';
  else if (/\bsamsungbrowser\b/.test(s)) browser = 'Samsung Internet';
  else if (/\bchrome\/|\bcrios\//.test(s)) browser = 'Chrome';
  else if (/\bfirefox\/|\bfxios\//.test(s)) browser = 'Firefox';
  else if (/\bsafari\//.test(s) && !/\bchrome\//.test(s)) browser = 'Safari';

  // Rótulo curto pronto para o painel (ex: "iPhone · Safari", "Desktop · Chrome").
  const label = device
    ? (browser ? `${device} · ${browser}` : device)
    : (browser || null);

  return { device, os, browser, label };
}

export default parseUserAgent;
