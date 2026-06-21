/**
 * Token invisível — codifica um tracking_id em caracteres invisíveis embutidos
 * na mensagem que o usuário envia no WhatsApp ao clicar no link.
 *
 * ⚠️ POR QUE TROCAMOS OS CARACTERES (2026-06-21):
 * Os zero-width clássicos (U+200B/U+200C/U+2060) são "format characters" (Cf) no
 * Unicode — e o WhatsApp do iPhone REMOVE essa categoria na sanitização do texto
 * (confirmado nos logs: token_detectado=false em todo teste iOS). A atribuição no
 * iPhone caía só no fallback por tempo (frágil com vários cliques).
 *
 * Agora os bits usam caracteres de OUTRAS categorias, que passam pelos filtros:
 *   BIT0 = U+2800 (Braille Pattern Blank) — categoria Symbol (So)
 *   BIT1 = U+3164 (Hangul Filler)         — categoria Letter (Lo)
 * Ambos invisíveis na prática e tratados como "conteúdo legítimo", não como
 * espaço/formato — por isso sobrevivem onde o zero-width some.
 *
 * RETROCOMPATÍVEL: o decoder ainda aceita o formato ANTIGO (U+200B/U+200C/U+2060)
 * para não quebrar links já gerados. O encoder só gera o formato NOVO.
 *
 * Formato: [INÍCIO][8 bits versão][N bits payload][8 bits checksum][FIM]
 * O checksum (soma dos bytes do payload mod 256) impede aceitar lixo invisível.
 */

// ── Formato NOVO (resistente ao iOS) ──
const N_BIT0 = '⠀'; // Braille Pattern Blank (Symbol)
const N_BIT1 = 'ㅤ'; // Hangul Filler (Letter)
const N_MARK = '⠀ㅤ'; // marcador de início/fim (par resistente)
const VERSION = 1;

// Regex do bloco NOVO: MARK + sequência de bits + MARK.
const N_BLOCO_RE = /⠀ㅤ[⠀ㅤ]+⠀ㅤ/;
const N_BITS_RE = /[⠀ㅤ]{24,}/g;

// ── Formato ANTIGO (zero-width — só para DECODIFICAR links já gerados) ──
const O_BIT0 = '​';
const O_BIT1 = '‌';
const O_BLOCO_RE = /⁠[​‌]+⁠/;
const O_BITS_RE = /[​‌]{24,}/g;

// Limpa TODOS os invisíveis (novo + antigo) da mensagem visível (defensivo).
const INVISIVEIS_RE = /[⠀ㅤ​‌⁠﻿]/g;

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
 * Codifica um tracking_id (string ASCII curta) num bloco invisível (formato novo).
 * Retorna a string de caracteres invisíveis a anexar à mensagem.
 */
export function encodeToken(trackingId) {
  if (!trackingId) return '';
  const payload = [...Buffer.from(String(trackingId), 'utf8')];
  const all = [VERSION, ...payload, checksum(payload)];
  const bits = bytesToBits(all);
  const invisible = [...bits].map(b => (b === '0' ? N_BIT0 : N_BIT1)).join('');
  return N_MARK + invisible + N_MARK;
}

// Tenta decodificar um conjunto de candidatos com um mapa de bits específico.
// bit0/bit1: caracteres que representam 0 e 1 nesse formato.
function tentarDecode(message, candidates, bit0, bit1) {
  for (const candidate of candidates) {
    try {
      const { bloco, inner } = candidate;
      const bits = [...inner].map(c => (c === bit0 ? '0' : c === bit1 ? '1' : '')).join('');
      const bytes = bitsToBytes(bits);
      if (bytes.length < 3) continue;

      const version = bytes[0];
      const cs = bytes[bytes.length - 1];
      const payload = bytes.slice(1, -1);
      if (version !== VERSION) continue;
      if (checksum(payload) !== cs) continue;

      const trackingId = Buffer.from(payload).toString('utf8');
      if (!/^[A-Za-z0-9_-]{4,40}$/.test(trackingId)) continue;
      return { trackingId, cleanMessage: message.replace(bloco, '') };
    } catch {
      // tenta o próximo candidato
    }
  }
  return null;
}

/**
 * Decodifica o tracking_id de uma mensagem. Retorna { trackingId, cleanMessage }.
 * Tenta primeiro o formato NOVO (U+2800/U+3164); se não achar, tenta o ANTIGO
 * (U+200B/U+200C) para manter links já gerados funcionando.
 */
export function decodeToken(message) {
  if (!message || typeof message !== 'string') {
    return { trackingId: null, cleanMessage: message || '' };
  }

  // 1) Formato NOVO — com marcador, depois só os bits (caso o marcador suma).
  const novoMarcado = message.match(N_BLOCO_RE);
  const novoCands = novoMarcado
    ? [{ bloco: novoMarcado[0], inner: novoMarcado[0].slice(N_MARK.length, -N_MARK.length) }]
    : [...message.matchAll(N_BITS_RE)].map(m => ({ bloco: m[0], inner: m[0] }));
  if (novoCands.length) {
    const r = tentarDecode(message, novoCands, N_BIT0, N_BIT1);
    if (r) return r;
  }

  // 2) Formato ANTIGO (retrocompatibilidade com links já gerados).
  const velhoMarcado = message.match(O_BLOCO_RE);
  const velhoCands = velhoMarcado
    ? [{ bloco: velhoMarcado[0], inner: velhoMarcado[0].slice(1, -1) }]
    : [...message.matchAll(O_BITS_RE)].map(m => ({ bloco: m[0], inner: m[0] }));
  if (velhoCands.length) {
    const r = tentarDecode(message, velhoCands, O_BIT0, O_BIT1);
    if (r) return r;
  }

  // Nada válido: devolve a mensagem sem qualquer invisível residual.
  return { trackingId: null, cleanMessage: message.replace(INVISIVEIS_RE, '') };
}

// Limpa qualquer invisível residual (uso defensivo no display, opcional).
export function stripZeroWidth(message) {
  return (message || '').replace(INVISIVEIS_RE, '');
}
