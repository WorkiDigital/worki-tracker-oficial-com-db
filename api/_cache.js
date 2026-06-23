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
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 500, 3000);
      },
    });
    redis.connect().catch(() => {});
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

/** Remove todas as entradas cujo nome começa com o prefixo informado. */
export async function cacheDeletePrefix(prefix) {
  for (const key of memStore.keys()) {
    if (key.startsWith(prefix)) memStore.delete(key);
  }

  if (redis && redisReady) {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor, 'MATCH', `${prefix}*`, 'COUNT', 100
        );
        cursor = nextCursor;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    } catch {
      // O fallback em memória já foi limpo; falha do Redis não bloqueia a ação.
    }
  }
}

export function cacheKey(...parts) {
  return parts.join(':');
}

/** Gera chave com escopo de usuário para evitar cross-user data leak */
export function userCacheKey(user, ...parts) {
  const scope = user?.cliente_id ?? `admin_${user?.id ?? 'unknown'}`;
  return [scope, ...parts].join(':');
}

// ── Persistent Metrics Cache (DB-backed) ───────────────────────
const METRICS_TTL = {
  hoje: 60 * 60 * 1000,           // 1 hora
  ontem: 6 * 60 * 60 * 1000,      // 6 horas
  historico: 24 * 60 * 60 * 1000 // 24 horas
};

import { getPool } from './_db.js';

export async function getCachedMetrics(cliente_id, account_id, data) {
  const pool = getPool();
  const res = await pool.query(
    'SELECT metrics, atualizado_em FROM metrics_cache WHERE cliente_id=$1 AND account_id=$2 AND data_referencia=$3',
    [cliente_id, account_id, data]
  );
  
  if (!res.rows[0]) return null;
  
  const hoje = new Date().toISOString().split('T')[0];
  const ontem = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  let ttl = METRICS_TTL.historico;
  if (data === hoje) ttl = METRICS_TTL.hoje;
  else if (data === ontem) ttl = METRICS_TTL.ontem;
  
  const idade = Date.now() - new Date(res.rows[0].atualizado_em).getTime();
  const cacheAge = Math.floor(idade / 60000);

  if (idade < ttl) {
    console.log(`[CACHE] HIT para ${account_id} em ${data} (Idade: ${cacheAge} min)`);
    return { ...res.rows[0].metrics, fromCache: true, cacheAge };
  }
  
  console.log(`[CACHE] MISS (STALE) para ${account_id} em ${data}`);
  return null;
}

export async function setCachedMetrics(cliente_id, account_id, data, metrics) {
  const pool = getPool();
  await pool.query(`
    INSERT INTO metrics_cache (cliente_id, account_id, data_referencia, metrics)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (cliente_id, account_id, data_referencia)
    DO UPDATE SET metrics=$4, atualizado_em=NOW()
  `, [cliente_id, account_id, data, metrics]);
  console.log(`[CACHE] SET para ${account_id} em ${data}`);
}
