// Per-user rate limiting using sliding window counters.
// Uses Redis when available, in-memory fallback.
// Attach to authenticated endpoints via: if (await rateLimit(req, res, user)) return;

import Redis from 'ioredis';

const WINDOW_MS = 60 * 1000;  // 1 minute window
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_RPM || '120', 10); // requests per minute per user

// ── Redis client (reuse from _cache.js via env) ────────────────
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

// ── In-memory fallback ─────────────────────────────────────────
const memWindows = new Map();
const MEM_MAX_ENTRIES = 10000;

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

// Cleanup stale entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memWindows) {
    if (now > v.resetAt) memWindows.delete(k);
  }
}, 5 * 60 * 1000).unref();

// ── Redis-based sliding window ─────────────────────────────────
async function redisCheck(key) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, windowStart);  // remove expired
  multi.zadd(key, now, `${now}:${Math.random()}`);  // add current
  multi.zcard(key);  // count in window
  multi.pexpire(key, WINDOW_MS);  // auto-cleanup
  const results = await multi.exec();
  const count = results[2][1]; // zcard result
  return { count, resetAt: now + WINDOW_MS };
}

/**
 * Check rate limit for a user. Returns true if request should be blocked (429 sent).
 * @param {object} req
 * @param {object} res
 * @param {object} user - Must have .id
 * @returns {Promise<boolean>} true = blocked (handler should return)
 */
export async function rateLimit(req, res, user) {
  if (!user?.id) return false; // skip if no user context

  const key = `rl:${user.id}`;

  try {
    const { count, resetAt } = (redis && redisReady)
      ? await redisCheck(key)
      : memCheck(key);

    // Set rate limit headers
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
    // If rate limit check fails, allow request through
    return false;
  }

  return false;
}
