/**
 * Token invisível — codifica um tracking_id em caracteres de largura zero,
 * embutidos na mensagem que o usuário envia no WhatsApp ao clicar no link.
 *
 * ⚠️ FRÁGIL POR NATUREZA: o WhatsApp/Baileys pode normalizar ou remover esses
 * caracteres dependendo do app (Android/iOS/Web). NUNCA dependa só do token —
 * o redirecionador também registra o clique no banco, e o webhook casa por
 * correlação (telefone + tempo) como fallback quando o token não chega.
 *
 * Codificação:
 *   ​ = bit 0   |   ‌ = bit 1
 *   ⁠ (WORD JOINER) marca início e fim do bloco.
 * Formato: [INÍCIO][8 bits versão][N bits payload][8 bits checksum][FIM]
 * O checksum (soma dos bytes do payload mod 256) impede aceitar lixo invisível.
 */

const BIT0 = '​';
const BIT1 = '‌';
const MARK = '⁠'; // início/fim
const VERSION = 1;

// Regex que captura QUALQUER sequência de marcadores+bits invisíveis na mensagem.
const BLOCO_RE = /⁠[​‌]+⁠/;
// Para limpar TODOS os zero-width da mensagem visível (defensivo no display).
const ZEROWIDTH_RE = /[​‌⁠﻿]/g;

function bytesToBits(bytes) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits;
}

function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return bytes;
}

function checksum(bytes) {
  return bytes.reduce((a, b) => (a + b) & 0xff, 0);
}

/**
 * Codifica um tracking_id (string ASCII curta) num bloco invisível.
 * Retorna a string de caracteres de largura zero a anexar à mensagem.
 */
export function encodeToken(trackingId) {
  if (!trackingId) return '';
  const payload = [...Buffer.from(String(trackingId), 'utf8')];
  const all = [VERSION, ...payload, checksum(payload)];
  const bits = bytesToBits(all);
  const invisible = [...bits].map(b => (b === '0' ? BIT0 : BIT1)).join('');
  return MARK + invisible + MARK;
}

/**
 * Decodifica o tracking_id de uma mensagem. Retorna { trackingId, cleanMessage }
 * onde cleanMessage é a mensagem visível com o bloco removido.
 * Se não houver token válido (checksum/formato), trackingId = null e a mensagem
 * é devolvida apenas com o bloco de tracking removido (não mexe no resto).
 */
export function decodeToken(message) {
  if (!message || typeof message !== 'string') {
    return { trackingId: null, cleanMessage: message || '' };
  }
  const match = message.match(BLOCO_RE);
  if (!match) {
    return { trackingId: null, cleanMessage: message };
  }
  const bloco = match[0];
  // Remove APENAS o bloco identificado (não varre a mensagem inteira às cegas).
  const cleanMessage = message.replace(bloco, '');

  try {
    const inner = bloco.slice(1, -1); // tira os MARK
    const bits = [...inner].map(c => (c === BIT0 ? '0' : c === BIT1 ? '1' : '')).join('');
    const bytes = bitsToBytes(bits);
    if (bytes.length < 3) return { trackingId: null, cleanMessage };

    const version = bytes[0];
    const cs = bytes[bytes.length - 1];
    const payload = bytes.slice(1, -1);
    if (version !== VERSION) return { trackingId: null, cleanMessage };
    if (checksum(payload) !== cs) return { trackingId: null, cleanMessage };

    const trackingId = Buffer.from(payload).toString('utf8');
    return { trackingId, cleanMessage };
  } catch {
    return { trackingId: null, cleanMessage };
  }
}

// Limpa qualquer zero-width residual (uso defensivo no display, opcional).
export function stripZeroWidth(message) {
  return (message || '').replace(ZEROWIDTH_RE, '');
}
