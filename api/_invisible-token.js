/**
 * Token invisível — codifica um tracking_id em caracteres invisíveis embutidos
 * na mensagem que o usuário envia no WhatsApp ao clicar no link.
 *
 * ⚠️ HISTÓRICO (2026-06-21):
 * - Zero-width clássicos (U+200B/U+200C/U+2060) são "format chars" (Cf): o iPhone
 *   os REMOVE na sanitização → token sumia no iOS (token_detectado=false).
 * - Trocamos para fillers Hangul (categoria Letter) + Braille, que SOBREVIVEM ao
 *   iOS. Funcionou, mas U+2800/U+3164 a 1 bit/char (~100 chars) deixavam um espaço
 *   feio e largo na mensagem.
 *
 * SOLUÇÃO ATUAL — base-4 com 4 fillers invisíveis (2 bits por caractere):
 *   00=U+115F  01=U+1160  10=U+3164  11=U+FFA0  (todos Hangul fillers, invisíveis,
 *   categoria Letter → passam pelos filtros do WhatsApp iOS).
 * Isso reduz o token de ~100 para ~30 caracteres. Ainda há largura mínima, então o
 * token é posto no FIM, após uma quebra de linha, isolando-o do texto visível.
 *
 * RETROCOMPATÍVEL: o decoder ainda lê os formatos antigos (U+2800/U+3164 a 1 bit e
 * o zero-width original) para não quebrar links já gerados.
 *
 * Formato: [8 bits versão][N bits payload][8 bits checksum], 2 bits por caractere.
 * O checksum (soma dos bytes do payload mod 256) impede aceitar lixo invisível.
 */

// ── Alfabeto base-4 (NOVO, compacto) ── 2 bits por caractere.
const Q = ['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ']; // U+115F, U+1160, U+3164, U+FFA0
const Q_MAP = { 'ᅟ': 0, 'ᅠ': 1, 'ㅤ': 2, 'ﾠ': 3 };
const Q_CLASS = '[ᅟᅠㅤﾠ]';
const Q_SEQ_RE = new RegExp(`${Q_CLASS}{16,}`, 'g'); // sequência longa = candidato
const VERSION = 1;

// ── Formato ANTIGO 0 (zero-width) — só DECODIFICAR ──
const Z_BIT0 = '​', Z_BIT1 = '‌';
const Z_BLOCO_RE = /⁠[​‌]+⁠/;
const Z_BITS_RE = /[​‌]{24,}/g;

// Limpa TODOS os invisíveis usados (novo base-4 + zero-width antigo) da mensagem.
const INVISIVEIS_RE = /[ᅟᅠㅤﾠ⠀​‌⁠﻿]/g;

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
 * Codifica um tracking_id num bloco invisível compacto (base-4, formato novo).
 * Prefixa uma quebra de linha para isolar o bloco do texto visível.
 */
export function encodeToken(trackingId) {
  if (!trackingId) return '';
  const payload = [...Buffer.from(String(trackingId), 'utf8')];
  const all = [VERSION, ...payload, checksum(payload)];
  let bits = bytesToBits(all);
  if (bits.length % 2) bits += '0'; // par para agrupar de 2 em 2
  let out = '';
  for (let i = 0; i < bits.length; i += 2) {
    out += Q[parseInt(bits.slice(i, i + 2), 2)];
  }
  // \n isola o bloco invisível do texto principal (fica numa "linha" própria,
  // sem quebrar a frase visível). O decoder remove o bloco e o \n residual.
  return '\n' + out;
}

// Decodifica bits (string "0"/"1") → tracking_id validado, ou null.
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
 * Decodifica o tracking_id de uma mensagem. Tenta o formato NOVO (base-4) e os
 * ANTIGOS (1 bit Braille/Hangul e zero-width) — retrocompatível com links já gerados.
 * Retorna { trackingId, cleanMessage }.
 */
export function decodeToken(message) {
  if (!message || typeof message !== 'string') {
    return { trackingId: null, cleanMessage: message || '' };
  }

  // 1) NOVO base-4: cada char = 2 bits.
  for (const m of message.matchAll(Q_SEQ_RE)) {
    const bloco = m[0];
    let bits = '';
    for (const ch of bloco) bits += Q_MAP[ch].toString(2).padStart(2, '0');
    const id = bitsToTrackingId(bits);
    if (id) {
      // Remove o bloco e a quebra de linha que o precede (se houver).
      const clean = message.replace(new RegExp(`\\n?${escapeRe(bloco)}`), '');
      return { trackingId: id, cleanMessage: clean };
    }
  }

  // 2) ANTIGO zero-width (com ou sem marcadores) — links gerados antes da troca.
  const zMark = message.match(Z_BLOCO_RE);
  const zCands = zMark ? [zMark[0].slice(1, -1)] : [...message.matchAll(Z_BITS_RE)].map(m => m[0]);
  for (const inner of zCands) {
    const bits = [...inner].map(c => (c === Z_BIT0 ? '0' : c === Z_BIT1 ? '1' : '')).join('');
    const id = bitsToTrackingId(bits);
    if (id) {
      const bloco = zMark ? zMark[0] : inner;
      return { trackingId: id, cleanMessage: message.replace(bloco, '') };
    }
  }

  return { trackingId: null, cleanMessage: message.replace(INVISIVEIS_RE, '') };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Limpa qualquer invisível residual (uso defensivo no display, opcional).
export function stripZeroWidth(message) {
  return (message || '').replace(INVISIVEIS_RE, '');
}
