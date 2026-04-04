// Cache layer — Redis when available, in-memory fallback
import Redis from 'ioredis';

const TTL_MS = 15 * 60 * 1000; // 15 minutes default

// ── Redis client (singleton) ───────────────────────────────────
let redis = null;
let redisReady = false;

if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      lazyConnect: false,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 500, 3000);
      },
    });
    redis.on('connect', () => { redisReady = true; console.log('✅ Redis connected'); });
    redis.on('error', (err) => { redisReady = false; console.error('⚠ Redis error:', err.message); });
    redis.on('close', () => { redisReady = false; });
  } catch (e) {
    console.error('⚠ Redis init failed, using in-memory fallback:', e.message);
  }
}

// ── In-memory fallback ─────────────────────────────────────────
const memStore = new Map();
const MAX_MEM_ENTRIES = 500;

function memGet(key) {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memStore.delete(key); return null; }
  return entry.data;
}

function memSet(key, data, ttlMs) {
  if (memStore.size >= MAX_MEM_ENTRIES) {
    const oldest = memStore.keys().next().value;
    memStore.delete(oldest);
  }
  memStore.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Public API (same interface, Redis or memory) ───────────────
export async function cacheGet(key) {
  if (redis && redisReady) {
    try {
      const raw = await redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return memGet(key);
    }
  }
  return memGet(key);
}

export async function cacheSet(key, data, ttlMs = TTL_MS) {
  if (redis && redisReady) {
    try {
      const ttlSec = Math.ceil(ttlMs / 1000);
      await redis.set(key, JSON.stringify(data), 'EX', ttlSec);
      return;
    } catch { /* fallback to memory */ }
  }
  memSet(key, data, ttlMs);
}

export function cacheKey(...parts) {
  return parts.join(':');
}

/** Gera chave com escopo de usuário para evitar cross-user data leak */
export function userCacheKey(user, ...parts) {
  const scope = user?.cliente_id ?? `admin_${user?.id ?? 'unknown'}`;
  return [scope, ...parts].join(':');
}
