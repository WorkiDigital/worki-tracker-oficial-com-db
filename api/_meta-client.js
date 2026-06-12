// Wrapper around fetch with automatic retry on Meta API rate limits (429)
// and transient errors (5xx). Uses exponential backoff.
import { logMetaCall } from './_logger.js';

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30000;

export async function fetchMeta(url, opts = {}) {
  let lastError;
  const t0 = Date.now();
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const r = await fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timeout));

      // Success or client error (4xx except 429) — return immediately
      if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429)) {
        logMetaCall(url, { durationMs: Date.now() - t0, status: r.status, retries: attempt });
        return r;
      }

      // Rate limit (429) or server error (5xx) — retry with backoff
      if (r.status === 429 || r.status >= 500) {
        lastError = new Error(`Meta API ${r.status}`);
        if (attempt < MAX_RETRIES) {
          const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
        logMetaCall(url, { durationMs: Date.now() - t0, status: r.status, retries: attempt, error: lastError.message });
        return r; // return last response after all retries
      }

      return r;
    } catch (e) {
      // Network error — retry
      lastError = e;
      if (attempt < MAX_RETRIES) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      logMetaCall(url, { durationMs: Date.now() - t0, status: 0, retries: attempt, error: e.message });
      throw e;
    }
  }
  throw lastError;
}

// Helper: fetch all pages from Meta Graph API
export async function fetchMetaAllPages(initialUrl) {
  const allData = [];
  let url = initialUrl;
  while (url) {
    const r = await fetchMeta(url);
    const json = await r.json();
    if (json.error) throw json.error;
    allData.push(...(json.data || []));
    url = json.paging?.next || null;
  }
  return allData;
}
