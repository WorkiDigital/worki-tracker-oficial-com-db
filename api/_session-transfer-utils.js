import crypto from 'crypto';

export {
  createPlatformCode,
  fetchEvolutionJson,
  hashPlatformCode,
  normalizePhone,
  normalizePlatformCode,
  secondsFromEnv,
} from './_extension-pairing-utils.js';

export function hashPhone(phone) {
  if (typeof phone !== 'string' || !phone) return null;
  return crypto.createHash('sha256').update(phone).digest('hex');
}

export const BufferJSON = {
  replacer: (_key, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
      return { type: 'Buffer', data: Buffer.from(value?.data || value).toString('base64') };
    }
    return value;
  },
  reviver: (_key, value) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      value.type === 'Buffer' &&
      typeof value.data === 'string'
    ) {
      return Buffer.from(value.data, 'base64');
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length > 0 && keys.every(k => !Number.isNaN(Number.parseInt(k, 10)))) {
        const values = Object.values(value);
        if (values.every(v => typeof v === 'number')) return Buffer.from(values);
      }
    }
    return value;
  },
};

function decodeCreds(credsJsonString) {
  if (typeof credsJsonString !== 'string' || !credsJsonString) {
    return { valid: false, reason: 'EMPTY_PAYLOAD' };
  }

  let innerString;
  try {
    innerString = JSON.parse(credsJsonString);
  } catch {
    return { valid: false, reason: 'NOT_VALID_JSON' };
  }
  if (typeof innerString !== 'string') {
    return { valid: false, reason: 'NOT_DOUBLE_SERIALIZED' };
  }

  let creds;
  try {
    creds = JSON.parse(innerString, BufferJSON.reviver);
  } catch {
    return { valid: false, reason: 'INNER_NOT_VALID_JSON' };
  }
  if (!creds || typeof creds !== 'object' || Array.isArray(creds)) {
    return { valid: false, reason: 'NOT_AN_OBJECT' };
  }

  const required = [
    'noiseKey',
    'signedIdentityKey',
    'signedPreKey',
    'registrationId',
    'me',
    'account',
  ];
  if (required.some(key => !(key in creds))) {
    return { valid: false, reason: 'MISSING_EXPECTED_FIELDS' };
  }

  const phone = String(creds.me?.id || '').match(/^(\d{8,15})(?::\d+)?@/)?.[1] || null;
  if (!phone) return { valid: false, reason: 'PHONE_NOT_DETECTED' };

  return { valid: true, creds, phone };
}

export function validateCredsStructure(credsJsonString) {
  const result = decodeCreds(credsJsonString);
  return result.valid
    ? { valid: true, detectedPhone: result.phone }
    : { valid: false, reason: result.reason };
}

export function detectedPhoneFromCreds(credsJsonString) {
  const result = decodeCreds(credsJsonString);
  return result.valid ? result.phone : null;
}

export function payloadLimitBytes() {
  const parsed = Number.parseInt(process.env.SESSION_TRANSFER_MAX_PAYLOAD_BYTES || '', 10);
  if (!Number.isFinite(parsed)) return 512 * 1024;
  return Math.min(Math.max(parsed, 64 * 1024), 2 * 1024 * 1024);
}
