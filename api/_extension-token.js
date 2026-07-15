// JWT próprio da extensão — separado do JWT normal de login (JWT_SECRET).
// Usa segredo (EXTENSION_JWT_SECRET) e audience/issuer distintos, TTL curto,
// e escopos explícitos (o token só serve para start/status daquele pairing
// específico, nunca para nenhuma outra rota do painel).
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { secondsFromEnv } from './_extension-pairing-utils.js';

const AUDIENCE = 'wapptrack-extension';
const ISSUER = 'worki-tracker';

function getSecret() {
  const secret = process.env.EXTENSION_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('EXTENSION_JWT_SECRET_NOT_CONFIGURED');
  }
  return secret;
}

export function issueExtensionToken(pairing) {
  const expiresIn = secondsFromEnv('EXTENSION_ACCESS_TOKEN_TTL_SECONDS', 180, 60, 300);
  const jti = crypto.randomUUID();

  const token = jwt.sign(
    {
      pairing_id: pairing.id,
      cliente_id: pairing.cliente_id,
      scope: ['pairing:start', 'pairing:status'],
    },
    getSecret(),
    {
      expiresIn,
      audience: AUDIENCE,
      issuer: ISSUER,
      jwtid: jti,
      subject: String(pairing.created_by || pairing.cliente_id),
    }
  );

  return { token, jti, expiresIn };
}

export function verifyExtensionToken(req, requiredScope) {
  const raw = String(req.headers.authorization || '');
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getSecret(), { audience: AUDIENCE, issuer: ISSUER });
    if (!Array.isArray(decoded.scope) || !decoded.scope.includes(requiredScope)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
