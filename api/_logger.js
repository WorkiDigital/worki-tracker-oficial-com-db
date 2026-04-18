// Structured JSON logger for API requests and Meta API calls.
// Outputs one JSON line per event — ready for LogTail, Datadog, EasyPanel logs.

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level) {
  return (LEVELS[level] ?? 1) >= (LEVELS[LOG_LEVEL] ?? 1);
}

function emit(level, event, data) {
  if (!shouldLog(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Log an API request (call at end of handler) */
export function logRequest(endpoint, { userId, accountId, durationMs, status, cacheHit, error }) {
  emit(error ? 'error' : 'info', 'api_request', {
    endpoint,
    userId: userId ?? null,
    accountId: accountId ?? null,
    durationMs: Math.round(durationMs),
    status,
    cacheHit: cacheHit ?? false,
    error: error ?? null,
  });
}

/** Log a Meta API call (used inside _meta-client.js) */
export function logMetaCall(url, { durationMs, status, retries, error }) {
  const endpoint = extractMetaEndpoint(url);
  emit(status === 429 || error ? 'warn' : 'debug', 'meta_api', {
    endpoint,
    durationMs: Math.round(durationMs),
    status,
    retries: retries ?? 0,
    error: error ?? null,
  });
}

/** General-purpose log */
export function log(level, event, data = {}) {
  emit(level, event, data);
}

function extractMetaEndpoint(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/v\d+\.\d+\//, '');
  } catch {
    return url?.substring(0, 80) ?? 'unknown';
  }
}
