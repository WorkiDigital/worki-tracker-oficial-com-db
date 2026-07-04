// Shared CORS + HTTP method guard for all API handlers.
// Usage:
//   import { cors } from './_cors.js';
//   export default async function handler(req, res) {
//     if (cors(req, res, ['GET'])) return;   // handles OPTIONS + blocks wrong methods
//     ...
//   }

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (ALLOWED_ORIGINS.includes('*')) return true;
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(ao => {
    if (ao === origin) return true;
    // Support wildcard subdomains: *.example.com
    if (ao.startsWith('*.')) {
      const domain = ao.slice(1); // .example.com
      return origin.endsWith(domain) || origin === `https://${ao.slice(2)}` || origin === `http://${ao.slice(2)}`;
    }
    return false;
  });
}

/**
 * Apply CORS headers and method validation.
 * @param {object} req
 * @param {object} res
 * @param {string[]} methods - Allowed methods, e.g. ['GET'] or ['POST','PATCH']
 * @param {{ public?: boolean, openOrigin?: boolean }} opts - `public`: only Content-Type header
 *   is allowed (no Authorization). `openOrigin`: reflete qualquer Origin em vez de usar a
 *   whitelist de ALLOWED_ORIGINS — para endpoints públicos e sem sessão/cookie chamados por
 *   scripts instalados em domínios de terceiros (ex: wapptrack.js), cuja segurança real vem
 *   de outro mecanismo (ex: slug de campanha + allowed_domains), não da origin do fetch.
 * @returns {boolean} true if the request was fully handled (OPTIONS or 405) — caller should return early
 */
export function cors(req, res, methods = ['GET'], opts = {}) {
  const origin = req.headers?.origin || '*';
  const allowed = opts.openOrigin
    ? (origin || '*')
    : (isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0] || '*');

  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Access-Control-Allow-Headers', opts.public ? 'Content-Type' : 'Authorization, Content-Type');

  if (opts.openOrigin || (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes('*'))) {
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  if (!methods.includes(req.method)) {
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return true;
  }

  return false;
}
