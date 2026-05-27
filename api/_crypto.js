import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

// Verifica se a chave está presente e tem o tamanho correto (64 caracteres hex = 32 bytes)
if (!process.env.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY.length !== 64) {
  // Em tempo de execução da API, apenas avisamos se a chave estiver errada para evitar crash
  // O setup-db.js já bloqueia a instalação se estiver faltando.
  console.warn('⚠️ TOKEN_ENCRYPTION_KEY ausente ou inválida em api/_crypto.js');
}

const KEY = process.env.TOKEN_ENCRYPTION_KEY ? Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex') : null;

/**
 * Criptografa um token de texto puro.
 * Retorna um Buffer contendo [IV (12b) + Tag (16b) + Cifra]
 */
export function encryptToken(plain) {
  if (!KEY) throw new Error('Criptografia indisponível: Chave não configurada.');
  if (!plain) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Descriptografa um Buffer de token.
 * O buffer deve estar no formato [IV (12b) + Tag (16b) + Cifra]
 */
export function decryptToken(buffer) {
  if (!KEY) throw new Error('Criptografia indisponível: Chave não configurada.');
  if (!buffer) return null;

  try {
    const iv = buffer.slice(0, 12);
    const tag = buffer.slice(12, 28);
    const encrypted = buffer.slice(28);
    
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('❌ Erro na descriptografia do token:', err.message);
    throw new Error('Falha ao descriptografar o token. Verifique a chave de criptografia.');
  }
}
