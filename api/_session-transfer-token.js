import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { secondsFromEnv } from './_session-transfer-utils.js';

const AUDIENCE = 'wapptrack-session-transfer';
const ISSUER = 'worki-tracker';

function getSecret() {
  const secret = process.env.EXTENSION_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('EXTENSION_JWT_SECRET_NOT_CONFIGURED');
  }
  return secret;
}

export function issueSessionTransferToken(transfer) {
  const expiresIn = secondsFromEnv('EXTENSION_ACCESS_TOKEN_TTL_SECONDS', 180, 60, 300);
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      transfer_id: transfer.id,
      cliente_id: transfer.cliente_id,
      scope: [
        'session-transfer:upload',
        'session-transfer:import',
        'session-transfer:status',
      ],
    },
    getSecret(),
    {
      expiresIn,
      audience: AUDIENCE,
      issuer: ISSUER,
      jwtid: jti,
      subject: String(transfer.created_by || transfer.cliente_id),
    },
  );
  return { token, jti, expiresIn };
}

export function verifySessionTransferToken(req, requiredScope) {
  const raw = String(req.headers?.authorization || '');
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getSecret(), {
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    if (!Array.isArray(decoded.scope) || !decoded.scope.includes(requiredScope)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
