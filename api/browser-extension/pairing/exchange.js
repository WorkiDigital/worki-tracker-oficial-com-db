// POST /api/browser-extension/pairing/exchange
// Rota pública (sem JWT normal) — o popup da extensão troca o código colado
// pelo usuário por um JWT de extensão escopado. Nunca loga o código/hash/JWT.
//
// IMPORTANTE: a extensão real confirma que "whatsapp.detectedPhoneNumber"
// quase sempre vem null (o WhatsApp Web não expõe o telefone da própria
// conta de forma estável no DOM) — a validação de telefone só roda quando o
// dado vier preenchido; ausência de telefone NUNCA bloqueia o fluxo.
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
  const detectedPhone = normalizePhone(String(req.body?.whatsapp?.detectedPhoneNumber || ''));

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
    // Só valida telefone quando a extensão de fato conseguiu detectar um —
    // hoje ela sempre manda null, então este branch é best-effort/futuro.
    if (detectedPhone && detectedPhone !== pairing.expected_phone) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'PHONE_MISMATCH' });
    }

    const issued = issueExtensionToken(pairing);

    await client.query(
      `UPDATE wa_extension_pairings
       SET consumed_at=NOW(), status='EXCHANGED', token_jti=$1, updated_at=NOW()
       WHERE id=$2`,
      [issued.jti, pairing.id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      accessToken: issued.token,
      pairingRequestId: pairing.id,
      expectedPhoneNumber: pairing.expected_phone,
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
