// POST /api/browser-extension/pairing/exchange
// Rota pública (sem JWT normal) — o popup da extensão troca o código colado
// pelo usuário por um JWT de extensão escopado. Nunca loga o código/hash/JWT.
//
// Telefone: a extensão detecta o número consultando o wid/me interno do
// WhatsApp Web (WA-JS) DEPOIS do login — não é confiável a 100% (contas com
// @lid podem não resolver o telefone ainda). Por isso o código temporário do
// painel continua obrigatório para identificar usuário/tenant/instância; o
// telefone em si é opcional aqui e pode chegar de 3 formas:
//   1. Já veio fixado no /create (expected_phone preenchido).
//   2. Detectado agora pela extensão (whatsapp.detectedPhone) — grava aqui.
//   3. Nenhum dos dois — fica NULL; o /start exige e aceita como fallback
//      manual (usuário digita na própria extensão).
// detectionMethod: 'WID' | 'LID_UNRESOLVED' | 'UNAVAILABLE' (apenas informativo/log).
import { getPool } from '../../_db.js';
import { rateLimitByIp } from '../../_rate-limit-ip.js';
import { extensionCors } from '../../_extension-origin.js';
import { ensureExtensionPairingSchema } from '../../_extension-pairing-schema.js';
import {
  hashPlatformCode,
  normalizePhone,
  normalizePlatformCode,
} from '../../_extension-pairing-utils.js';
import { issueExtensionToken } from '../../_extension-token.js';

export default async function handler(req, res) {
  if (extensionCors(req, res, ['POST'])) return;
  if (await rateLimitByIp(req, res)) return;

  await ensureExtensionPairingSchema();

  const normalizedCode = normalizePlatformCode(req.body?.code);
  const whatsappStatus = req.body?.whatsapp?.status;
  const detectedPhoneRaw = String(req.body?.whatsapp?.detectedPhone || '').trim();
  const detectedPhone = detectedPhoneRaw ? normalizePhone(detectedPhoneRaw) : null;
  const detectionMethod = String(req.body?.whatsapp?.detectionMethod || '').slice(0, 40);

  if (!normalizedCode) {
    return res.status(400).json({ code: 'PAIRING_CODE_INVALID' });
  }
  if (whatsappStatus !== 'LOGGED_IN') {
    return res.status(409).json({ code: 'WHATSAPP_NOT_LOGGED_IN' });
  }

  const codeHash = hashPlatformCode(normalizedCode);
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT * FROM wa_extension_pairings WHERE code_hash=$1 FOR UPDATE`,
      [codeHash]
    );
    const pairing = found.rows[0];

    if (!pairing) {
      await client.query('ROLLBACK');
      return res.status(400).json({ code: 'PAIRING_CODE_INVALID' });
    }
    if (pairing.consumed_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'PAIRING_CODE_USED' });
    }
    if (new Date(pairing.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE wa_extension_pairings SET status='EXPIRED', updated_at=NOW() WHERE id=$1`,
        [pairing.id]
      );
      await client.query('COMMIT');
      return res.status(410).json({ code: 'PAIRING_CODE_EXPIRED' });
    }
    let expectedPhone = pairing.expected_phone;
    if (expectedPhone && detectedPhone && detectedPhone !== expectedPhone) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'PHONE_MISMATCH' });
    }
    if (!expectedPhone && detectedPhone) {
      expectedPhone = detectedPhone;
    }

    const issued = issueExtensionToken(pairing);

    await client.query(
      `UPDATE wa_extension_pairings
       SET consumed_at=NOW(), status='EXCHANGED', token_jti=$1, expected_phone=$2, updated_at=NOW()
       WHERE id=$3`,
      [issued.jti, expectedPhone, pairing.id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      accessToken: issued.token,
      pairingRequestId: pairing.id,
      expectedPhoneNumber: expectedPhone,
      phoneRequired: !expectedPhone,
      detectionMethod: detectionMethod || null,
      expiresInSeconds: issued.expiresIn,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[pairing/exchange] erro:', error.message);
    return res.status(500).json({ code: 'PAIRING_EXCHANGE_FAILED' });
  } finally {
    client.release();
  }
}
