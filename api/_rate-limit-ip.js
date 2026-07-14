// Rate limiting por IP, para endpoints PÚBLICOS sem autenticação (sites de
// terceiros, sem usuário logado) — api/_rate-limit.js exige user.id e por isso
// não protege esses endpoints. Mesma técnica (sliding window, Redis com
// fallback em memória), chave diferente (por IP em vez de por usuário).
import Redis from 'ioredis';
import { extractClientIp } from './_geoip.js';

const WINDOW_MS = 60 * 1000; // 1 minuto
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_PUBLIC_RPM || '60', 10); // por IP/minuto

let redis = null;
let redisReady = false;

if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
      retryStrategy(times) { return times > 3 ? null : Math.min(times * 300, 2000); },
    });
    redis.connect().catch(() => {});
    redis.on('connect', () => { redisReady = true; });
    redis.on('error', () => { redisReady = false; });
    redis.on('close', () => { redisReady = false; });
  } catch { /* fallback to memory */ }
}

const memWindows = new Map();
const MEM_MAX_ENTRIES = 20000;

function memCheck(key) {
  const now = Date.now();
  let entry = memWindows.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
  }
  entry.count++;
  memWindows.set(key, entry);

  if (memWindows.size > MEM_MAX_ENTRIES) {
    const oldest = memWindows.keys().next().value;
    memWindows.delete(oldest);
  }

  return { count: entry.count, resetAt: entry.resetAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memWindows) {
    if (now > v.resetAt) memWindows.delete(k);
  }
}, 5 * 60 * 1000).unref();

async function redisCheck(key) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, windowStart);
  multi.zadd(key, now, `${now}:${Math.random()}`);
  multi.zcard(key);
  multi.pexpire(key, WINDOW_MS);
  const results = await multi.exec();
  const count = results[2][1];
  return { count, resetAt: now + WINDOW_MS };
}

/**
 * Rate limit por IP para endpoints públicos sem usuário autenticado.
 * @returns {Promise<boolean>} true = bloqueado (429 já enviado)
 */
export async function rateLimitByIp(req, res) {
  const ip = extractClientIp(req) || 'unknown';
  const key = `rlip:${ip}`;

  try {
    const { count, resetAt } = (redis && redisReady)
      ? await redisCheck(key)
      : memCheck(key);

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

    if (count > MAX_REQUESTS) {
      res.status(429).json({
        error: 'Limite de requisições excedido. Aguarde 1 minuto.',
        retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
      });
      return true;
    }
  } catch {
    return false;
  }

  return false;
}
