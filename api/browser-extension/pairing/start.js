// POST /api/browser-extension/pairing/start
// Bearer JWT de extensão (emitido por exchange.js). Chama a Evolution API
// para iniciar o pareamento por número — é a ÚNICA rota que conhece a
// EVOLUTION_GLOBAL_KEY neste fluxo. Idempotente: se já existe um pairingCode
// válido não expirado, devolve o mesmo sem rechamar a Evolution.
//
// Telefone: normalmente já chega definido (detectado em exchange.js). Se
// detecção falhou lá (ex: conta @lid não resolvida), este é o último ponto
// onde a extensão pode enviar o telefone confirmado manualmente pelo
// usuário — sem ele, PHONE_REQUIRED (não há como chamar a Evolution).
import { getPool } from '../../_db.js';
import { encryptToken, decryptToken } from '../../_crypto.js';
import { rateLimitByIp } from '../../_rate-limit-ip.js';
import { extensionCors } from '../../_extension-origin.js';
import { ensureExtensionPairingSchema } from '../../_extension-pairing-schema.js';
import { verifyExtensionToken } from '../../_extension-token.js';
import {
  fetchEvolutionJson,
  normalizePairingCode,
  normalizePhone,
  secondsFromEnv,
} from '../../_extension-pairing-utils.js';

export default async function handler(req, res) {
  if (extensionCors(req, res, ['POST'])) return;
  if (await rateLimitByIp(req, res)) return;

  const auth = verifyExtensionToken(req, 'pairing:start');
  if (!auth) return res.status(401).json({ code: 'AUTHENTICATION_FAILED' });

  await ensureExtensionPairingSchema();

  const pairingRequestId = String(req.body?.pairingRequestId || '');
  const rawPhone = String(req.body?.detectedPhoneNumber || req.body?.phoneNumber || '').trim();
  const suppliedPhone = rawPhone ? normalizePhone(rawPhone) : null;

  if (pairingRequestId !== auth.pairing_id) {
    return res.status(403).json({ code: 'PAIRING_SCOPE_MISMATCH' });
  }

  const pool = getPool();
  const found = await pool.query(
    `SELECT p.* FROM wa_extension_pairings p
     JOIN instancias_mapeamento m ON m.instance_name=p.instance_name AND m.cliente_id=p.cliente_id
     WHERE p.id=$1 AND p.token_jti=$2 LIMIT 1`,
    [pairingRequestId, auth.jti]
  );
  const pairing = found.rows[0];

  if (!pairing) return res.status(404).json({ code: 'PAIRING_NOT_FOUND' });
  if (!['EXCHANGED', 'WAITING', 'CONNECTING'].includes(pairing.status)) {
    if (pairing.status === 'CONNECTED') {
      return res.status(409).json({ code: 'INSTANCE_ALREADY_CONNECTED' });
    }
    return res.status(409).json({ code: 'PAIRING_NOT_AVAILABLE' });
  }
  let expectedPhone = pairing.expected_phone;
  if (expectedPhone && suppliedPhone && suppliedPhone !== expectedPhone) {
    return res.status(409).json({ code: 'PHONE_MISMATCH' });
  }
  if (!expectedPhone) {
    // Nem create() nem exchange() conseguiram um telefone (detecção falhou,
    // ex: conta @lid ainda não resolvida) — este é o último ponto do fluxo
    // onde a extensão pode enviar o número confirmado manualmente pelo
    // usuário. Sem ele, não há como chamar a Evolution.
    if (!suppliedPhone) {
      return res.status(400).json({ code: 'PHONE_REQUIRED' });
    }
    expectedPhone = suppliedPhone;
    await pool.query(
      `UPDATE wa_extension_pairings SET expected_phone=$1, updated_at=NOW() WHERE id=$2`,
      [expectedPhone, pairing.id]
    );
  }

  // Idempotência: devolve o código ainda válido sem chamar a Evolution de novo.
  if (
    pairing.pairing_code_enc &&
    pairing.pairing_expires_at &&
    new Date(pairing.pairing_expires_at).getTime() > Date.now()
  ) {
    const savedCode = decryptToken(pairing.pairing_code_enc);
    return res.status(200).json({
      operationId: pairing.id,
      pairingCode: savedCode,
      phoneNumber: pairing.expected_phone,
      expiresAt: new Date(pairing.pairing_expires_at).toISOString(),
    });
  }

  const encodedInstance = encodeURIComponent(pairing.instance_name);

  try {
    // Evita chamar connect numa instância já aberta/conectando.
    const stateData = await fetchEvolutionJson(`/instance/connectionState/${encodedInstance}`);
    const state = String(stateData?.instance?.state || stateData?.state || '').toLowerCase();

    if (['open', 'connected', 'online'].includes(state)) {
      await pool.query(
        `UPDATE wa_extension_pairings SET status='CONNECTED', connected_at=NOW(), pairing_code_enc=NULL, updated_at=NOW() WHERE id=$1`,
        [pairing.id]
      );
      return res.status(409).json({ code: 'INSTANCE_ALREADY_CONNECTED' });
    }
    if (state === 'connecting' && !pairing.pairing_code_enc) {
      return res.status(409).json({ code: 'INSTANCE_CONNECTING' });
    }

    const data = await fetchEvolutionJson(
      `/instance/connect/${encodedInstance}?number=${encodeURIComponent(expectedPhone)}`
    );

    const pairingCode = normalizePairingCode(data?.pairingCode);
    if (!pairingCode) {
      await pool.query(
        `UPDATE wa_extension_pairings SET attempts=attempts+1, last_error_code='PAIRING_UNAVAILABLE', updated_at=NOW() WHERE id=$1`,
        [pairing.id]
      );
      return res.status(502).json({ code: 'PAIRING_UNAVAILABLE' });
    }

    const ttl = secondsFromEnv('EVOLUTION_PAIRING_TTL_SECONDS', 120, 60, 300);
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await pool.query(
      `UPDATE wa_extension_pairings
       SET status='WAITING', attempts=attempts+1, pairing_code_enc=$1, pairing_expires_at=$2,
           last_error_code=NULL, updated_at=NOW()
       WHERE id=$3`,
      [encryptToken(pairingCode), expiresAt, pairing.id]
    );

    return res.status(200).json({
      operationId: pairing.id,
      pairingCode,
      phoneNumber: expectedPhone,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    const publicCode = error.publicCode || 'PAIRING_UNAVAILABLE';
    const status = publicCode === 'EVOLUTION_UNAVAILABLE' ? 503 : 502;
    console.error('[pairing/start] erro:', error.message);
    return res.status(status).json({ code: publicCode });
  }
}
