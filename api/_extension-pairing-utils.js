// Utilitários compartilhados pelo fluxo de pareamento da extensão Chrome:
// geração/validação do código da plataforma, normalização de telefone e do
// pairingCode devolvido pela Evolution, e um wrapper de fetch para a Evolution
// com timeout — nenhuma lógica de negócio fica duplicada entre os endpoints.
import crypto from 'crypto';

// Código da plataforma: 8 bytes hex (16 chars), exibido como 4 blocos de 4
// (ex: 7A9F-31BC-D882-4E10). Normalizado remove os hífens antes de validar/hash.
export function normalizePlatformCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return /^[A-F0-9]{16}$/.test(normalized) ? normalized : null;
}

export function createPlatformCode() {
  const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
  return { raw, display: raw.match(/.{4}/g).join('-') };
}

// HMAC-SHA256 com pepper próprio (nunca o mesmo do JWT_SECRET normal) — o
// código em si nunca é persistido, só o hash, seguindo o mesmo espírito de
// "nunca guardar segredo em texto puro" já usado no projeto (ex: senha_hash).
export function hashPlatformCode(normalizedCode) {
  const pepper = process.env.PAIRING_CODE_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error('PAIRING_CODE_PEPPER_NOT_CONFIGURED');
  }
  return crypto.createHmac('sha256', pepper).update(normalizedCode).digest('hex');
}

export function normalizePhone(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

// pairingCode devolvido pela Evolution (formato observado: 8 caracteres
// alfanuméricos, às vezes com hífen no meio — normaliza removendo espaços/hífens).
export function normalizePairingCode(value) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(compact) ? compact : null;
}

export function secondsFromEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// Wrapper de fetch para a Evolution API — nunca expõe a apikey ao chamador,
// normaliza erros com um "publicCode" seguro para devolver ao cliente (nunca
// vaza payload cru/URL interna/apikey no corpo da resposta pública).
export async function fetchEvolutionJson(path, options = {}) {
  const base = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_GLOBAL_KEY;

  if (!base || !apiKey) {
    const error = new Error('EVOLUTION_NOT_CONFIGURED');
    error.publicCode = 'EVOLUTION_UNAVAILABLE';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        apikey: apiKey,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch {
        const error = new Error('INVALID_EVOLUTION_RESPONSE');
        error.publicCode = 'EVOLUTION_UNAVAILABLE';
        throw error;
      }
    }

    if (!response.ok) {
      const error = new Error(
        data?.response?.message?.[0] || data?.message || data?.error || `Evolution HTTP ${response.status}`
      );
      error.evolutionStatus = response.status;
      error.publicCode = response.status === 401 || response.status === 403
        ? 'EVOLUTION_UNAVAILABLE'
        : 'PAIRING_UNAVAILABLE';
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('EVOLUTION_TIMEOUT');
      timeoutError.publicCode = 'EVOLUTION_UNAVAILABLE';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
