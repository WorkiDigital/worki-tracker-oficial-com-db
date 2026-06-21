const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1500;
const MAX_CACHE_ENTRIES = 5000;
const cache = new Map();

function clean(value, max = 120) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function decodeHeader(value) {
  if (!value) return null;
  try { return decodeURIComponent(String(value)); }
  catch { return String(value); }
}

function normalizeIp(value) {
  let ip = String(value || '').split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function isPublicIp(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1') return false;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return false;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
  if (/^(fc|fd|fe80):/i.test(ip)) return false;
  return /^[0-9a-f:.]+$/i.test(ip);
}

function fromHeaders(headers = {}) {
  const countryCode = clean(headers['cf-ipcountry'] || headers['x-vercel-ip-country'], 8);
  const regionCode = clean(
    headers['cf-region-code'] || headers['x-vercel-ip-country-region'],
    16
  );
  const region = clean(decodeHeader(headers['cf-region'])) || regionCode;
  const city = clean(decodeHeader(headers['cf-ipcity'] || headers['x-vercel-ip-city']));
  if (!countryCode && !region && !city) return null;
  return {
    city,
    region,
    region_code: regionCode,
    country: countryCode,
    country_code: countryCode,
    source: 'proxy_headers',
  };
}

function interpolateUrl(template, ip) {
  return String(template).includes('{ip}')
    ? String(template).replaceAll('{ip}', encodeURIComponent(ip))
    : `${String(template).replace(/\/$/, '')}/${encodeURIComponent(ip)}`;
}

export function extractClientIp(req) {
  return normalizeIp(
    req.headers['cf-connecting-ip']
    || req.headers['x-real-ip']
    || req.headers['x-forwarded-for']
    || req.socket?.remoteAddress
  );
}

export async function lookupGeoIp(req, ip) {
  const headerGeo = fromHeaders(req.headers);
  if (headerGeo?.city && headerGeo?.country_code) return headerGeo;
  if (!isPublicIp(ip)) return headerGeo;

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Sem provedor explicitamente configurado, não envia o IP para terceiros.
  // Isso também evita usar indevidamente planos gratuitos sem licença comercial.
  const template = process.env.IP_GEOLOCATION_URL;
  if (!template) return headerGeo;
  try {
    const response = await fetch(interpolateUrl(template, ip), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return headerGeo;
    const data = await response.json();
    if (data?.success === false) return headerGeo;
    const value = {
      city: clean(data.city) || headerGeo?.city || null,
      region: clean(data.region || data.region_name) || headerGeo?.region || null,
      region_code: clean(data.region_code, 16) || headerGeo?.region_code || null,
      country: clean(data.country || data.country_name) || headerGeo?.country || null,
      country_code: clean(data.country_code, 8) || headerGeo?.country_code || null,
      source: 'ip_lookup',
    };
    cache.set(ip, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return value;
  } catch {
    return headerGeo;
  }
}
