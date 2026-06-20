/**
 * Rate limit público por IP. Usa Redis quando disponível para que o limite seja
 * compartilhado entre containers/serverless; cai para memória em desenvolvimento.
 */
import Redis from 'ioredis';

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;
const MEM_MAX_ENTRIES = 10000;

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
  } catch { /* fallback em memória */ }
}

const ipWindows = new Map();

function memCheck(key) {
  const now = Date.now();
  let entry = ipWindows.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
  }
  entry.count++;
  ipWindows.set(key, entry);
  if (ipWindows.size > MEM_MAX_ENTRIES) {
    ipWindows.delete(ipWindows.keys().next().value);
  }
  return entry;
}

async function redisCheck(key) {
  const now = Date.now();
  const redisKey = `rl:public:${key}`;
  const multi = redis.multi();
  multi.zremrangebyscore(redisKey, 0, now - WINDOW_MS);
  multi.zadd(redisKey, now, `${now}:${Math.random()}`);
  multi.zcard(redisKey);
  multi.pexpire(redisKey, WINDOW_MS);
  const results = await multi.exec();
  return { count: Number(results[2][1]), resetAt: now + WINDOW_MS };
}

export async function checkRateLimit(ip, res) {
  const key = String(ip || 'unknown').split(',')[0].trim();
  let entry;
  try {
    entry = redis && redisReady ? await redisCheck(key) : memCheck(key);
  } catch {
    entry = memCheck(key);
  }

  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - entry.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

  if (entry.count > MAX_REQUESTS) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Too Many Requests',
      message: 'Limite de requisições excedido para este IP. Aguarde 1 minuto.',
      retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000)
    }));
    return true;
  }
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipWindows) {
    if (now > entry.resetAt) ipWindows.delete(ip);
  }
}, 5 * 60 * 1000).unref();
