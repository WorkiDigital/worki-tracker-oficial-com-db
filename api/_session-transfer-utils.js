// Utilitários do fluxo de Session Transfer. Reaproveita os helpers genéricos
// já validados em produção pelo fluxo de pareamento (nunca o inverso — este
// arquivo nunca é importado por _extension-pairing-utils.js) e adiciona só o
// que é específico deste domínio.
import crypto from 'crypto';

export { normalizePhone, secondsFromEnv, fetchEvolutionJson } from './_extension-pairing-utils.js';

export function hashPhone(phone) {
  if (typeof phone !== 'string' || !phone) return null;
  return crypto.createHash('sha256').update(phone).digest('hex');
}

// Reimplementação local do BufferJSON.replacer/reviver do Baileys 7.0.0-rc.9
// (confirmado no código-fonte real da versão fixada em produção — ver
// WhiskeySockets/Baileys src/Utils/generics.ts). Deliberadamente NÃO
// instalamos o pacote "baileys": a versão exata que bateria com a produção
// (7.0.0-rc.9) tem uma vulnerabilidade zero-day pública conhecida
// (GHSA-qvv5-jq5g-4cgg). Como só precisamos desta função pura de
// serialização (nunca abrimos socket nem processamos mensagens), reimplementar
// evita trazer uma dependência com CVE conhecido para o projeto.
export const BufferJSON = {
  replacer: (_key, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
      return { type: 'Buffer', data: Buffer.from(value?.data || value).toString('base64') };
    }
    return value;
  },
  reviver: (_key, value) => {
    if (typeof value === 'object' && value !== null && value.type === 'Buffer' && typeof value.data === 'string') {
      return Buffer.from(value.data, 'base64');
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length > 0 && keys.every(k => !isNaN(parseInt(k, 10)))) {
        const values = Object.values(value);
        if (values.every(v => typeof v === 'number')) {
          return Buffer.from(values);
        }
      }
    }
    return value;
  },
};

// Valida que credsJsonString é uma string que, ao ser parseada uma vez, ainda
// é uma string (confirma a dupla serialização observada no schema real da
// Evolution — Session.creds é text, e jsonb_typeof(creds::jsonb) = 'string').
// Depois parseia essa string interna e checa uma chave estrutural mínima do
// AuthenticationCreds do Baileys. Checagem estrutural leve, não validação
// completa de schema — só para pegar "colou o arquivo errado" cedo.
export function validateCredsStructure(credsJsonString) {
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

  let credsObject;
  try {
    credsObject = JSON.parse(innerString, BufferJSON.reviver);
  } catch {
    return { valid: false, reason: 'INNER_NOT_VALID_JSON' };
  }

  if (typeof credsObject !== 'object' || credsObject === null || Array.isArray(credsObject)) {
    return { valid: false, reason: 'NOT_AN_OBJECT' };
  }

  const expectedKeys = ['noiseKey', 'signedIdentityKey', 'signedPreKey', 'registrationId', 'me', 'account'];
  const hasExpectedKey = expectedKeys.some(k => k in credsObject);
  if (!hasExpectedKey) {
    return { valid: false, reason: 'MISSING_EXPECTED_FIELDS' };
  }

  return { valid: true };
}
