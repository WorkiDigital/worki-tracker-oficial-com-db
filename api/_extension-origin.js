// CORS estrito para os endpoints da extensão Chrome. O cors() genérico do
// projeto (api/_cors.js) só ESCOLHE qual header devolver — ele nunca bloqueia
// a execução do handler quando a origem está fora da whitelist (quem bloqueia
// de fato é o navegador do lado cliente). Para estes endpoints, a origem
// exata da extensão precisa ser validada no servidor, porque o Bearer token
// sozinho não seria suficiente contra qualquer cliente HTTP falsificando headers.
export function extensionCors(req, res, allowedMethods = ['POST']) {
  const allowedOrigin = process.env.EXTENSION_ORIGIN;
  const origin = req.headers?.origin;

  if (!allowedOrigin || !allowedOrigin.startsWith('chrome-extension://')) {
    res.status(500).json({ code: 'EXTENSION_ORIGIN_NOT_CONFIGURED' });
    return true;
  }

  if (origin !== allowedOrigin) {
    res.status(403).json({ code: 'UNTRUSTED_EXTENSION_ORIGIN' });
    return true;
  }

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', [...allowedMethods, 'OPTIONS'].join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Extension-Version');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  if (!allowedMethods.includes(req.method)) {
    res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    return true;
  }

  return false;
}
