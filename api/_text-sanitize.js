/**
 * Remove emojis e símbolos decorativos de texto livre (ex: nome de contato do
 * WhatsApp), preservando letras (com acento), números, espaços e pontuação básica.
 */
export function limparTextoDecorativo(texto) {
  if (!texto) return texto;
  return String(texto)
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\p{Regional_Indicator}/gu, '') // bandeiras (ex: 🇧🇷 = 2 regional indicators)
    .replace(/[\u{FE0F}\u{200D}]/gu, '') // variation selector e zero-width joiner residuais
    .replace(/\s+/g, ' ')
    .trim();
}
