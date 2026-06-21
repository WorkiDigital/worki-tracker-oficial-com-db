/**
 * Token invisível — codifica um tracking_id em caracteres zero-width embutidos no
 * INÍCIO da mensagem que o usuário envia no WhatsApp ao clicar no link.
 *
 * FÓRMULA (2026-06-21) — replicada de um app de referência que funciona no iPhone:
 *   - SOMENTE dois caracteres: U+200B = bit 0, U+200C = bit 1.
 *   - SEM marcadores (o U+2060/word-joiner que usávamos antes atrapalhava).
 *   - Token no INÍCIO, colado ao texto, sem espaço e sem quebra de linha.
 *   - 8 bits por caractere do tracking_id (ID curto = token curto).
 * A URL final usa api.whatsapp.com/send?...&text=<encodeURIComponent(msg)>; o
 * percent-encoding UTF-8 (U+200B→%E2%80%8B, U+200C→%E2%80%8C) preserva os
 * caracteres na maioria dos casos.
 *
 * ⚠️ Continua FRÁGIL: o iPhone pode remover os zero-width. Por isso o fallback de
 * correlação por clique recente (webhook) permanece como rede de segurança — a
 * atribuição no iPhone pode vir dele, não necessariamente do token.
 *
 * Formato dos bits: [8 bits versão][N bits payload][8 bits checksum].
 * O checksum (soma dos bytes do payload mod 256) impede aceitar lixo invisível.
 */

const BIT0 = '​'; // zero-width space  → 0
const BIT1 = '‌'; // zero-width non-joiner → 1
const VERSION = 1;

// Sequência de bits no início (sem marcadores). Aceita também versões antigas que
// tinham marcadores U+2060 ao redor (retrocompat: o decoder os ignora).
const BITS_RE = /[​‌]{24,}/g;
// Limpa qualquer zero-width residual da mensagem visível (inclui U+2060/U+FEFF).
const INVISIVEIS_RE = /[​‌‍⁠﻿]/g;

function bytesToBits(bytes) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits;
}
function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return bytes;
}
function checksum(bytes) { return bytes.reduce((a, b) => (a + b) & 0xff, 0); }

/**
 * Codifica um tracking_id (ASCII curto) em zero-width, para prefixar a mensagem.
 * SÓ U+200B/U+200C, sem marcadores — exatamente o formato que sobrevive melhor.
 */
export function encodeToken(trackingId) {
  if (!trackingId) return '';
  const payload = [...Buffer.from(String(trackingId), 'utf8')];
  const all = [VERSION, ...payload, checksum(payload)];
  const bits = bytesToBits(all);
  return [...bits].map(b => (b === '0' ? BIT0 : BIT1)).join('');
}

function bitsToTrackingId(bits) {
  const bytes = bitsToBytes(bits);
  if (bytes.length < 3) return null;
  if (bytes[0] !== VERSION) return null;
  const cs = bytes[bytes.length - 1];
  const payload = bytes.slice(1, -1);
  if (checksum(payload) !== cs) return null;
  const id = Buffer.from(payload).toString('utf8');
  return /^[A-Za-z0-9_-]{4,40}$/.test(id) ? id : null;
}

/**
 * Decodifica o tracking_id de uma mensagem. Retorna { trackingId, cleanMessage }.
 * Varre todas as sequências longas de U+200B/U+200C (com ou sem marcadores antigos
 * em volta) e valida por versão+checksum. Retrocompatível com os links anteriores.
 */
export function decodeToken(message) {
  if (!message || typeof message !== 'string') {
    return { trackingId: null, cleanMessage: message || '' };
  }
  for (const m of message.matchAll(BITS_RE)) {
    const bloco = m[0];
    const bits = [...bloco].map(c => (c === BIT0 ? '0' : c === BIT1 ? '1' : '')).join('');
    const id = bitsToTrackingId(bits);
    if (id) {
      // Remove o bloco e marcadores U+2060 residuais grudados (formato antigo).
      const clean = message.replace(new RegExp(`\\u2060?${escapeRe(bloco)}\\u2060?`), '');
      return { trackingId: id, cleanMessage: clean };
    }
  }
  return { trackingId: null, cleanMessage: message.replace(INVISIVEIS_RE, '') };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Limpa qualquer invisível residual (uso defensivo no display, opcional).
export function stripZeroWidth(message) {
  return (message || '').replace(INVISIVEIS_RE, '');
}
