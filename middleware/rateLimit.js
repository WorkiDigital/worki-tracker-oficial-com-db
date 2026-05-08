/**
 * Middleware de Rate Limit baseado em IP (Sliding Window)
 * Protege o servidor contra ataques de negação de serviço (DoS) e flooding de webhooks.
 */

const WINDOW_MS = 60 * 1000; // 1 minuto
const MAX_REQUESTS = 100;    // limite de 100 req/min

// Armazenamento em memória (Map) para rastrear IPs
const ipWindows = new Map();

/**
 * Executa a verificação de rate limit para um IP.
 * @returns {boolean} true se deve ser bloqueado (429)
 */
export function checkRateLimit(ip, res) {
  const now = Date.now();
  let entry = ipWindows.get(ip);

  // Limpa janelas expiradas
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
  }

  entry.count++;
  ipWindows.set(ip, entry);

  // Define headers de Rate Limit
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - entry.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

  if (entry.count > MAX_REQUESTS) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Too Many Requests',
      message: 'Limite de requisições excedido para este IP. Aguarde 1 minuto.',
      retryAfter: Math.ceil((entry.resetAt - now) / 1000)
    }));
    return true;
  }

  return false;
}

// Limpeza periódica de memória para evitar vazamento
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipWindows) {
    if (now > entry.resetAt) ipWindows.delete(ip);
  }
}, 5 * 60 * 1000).unref();
