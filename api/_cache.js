// Shared in-memory cache for Meta API responses
// Key: string, Value: { data, expiresAt }
const store = new Map();

const TTL_MS = 15 * 60 * 1000; // 15 minutes

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
  return entry.data;
}

export function cacheSet(key, data, ttlMs = TTL_MS) {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function cacheKey(...parts) {
  return parts.join(':');
}
