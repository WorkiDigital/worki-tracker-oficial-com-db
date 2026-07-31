// POST /api/wa-connect-share-create
// Gera um link publico que espelha um QR Code de conexao WhatsApp JA GERADO
// pelo painel — nunca permite nenhuma acao alem da propria renovacao do QR
// (delete/logout/etc nao existem atraves do link). Pensado para o admin
// compartilhar com quem tem o celular fisico, sem precisar dar acesso ao
// painel. Token de uso unico; o QR individual expira rapido (renovado
// sozinho por api/wa-connect-public.js), mas o LINK fica valido por mais
// tempo (WA_LINK_TTL_SECONDS) para nao pressionar quem recebeu o link.
import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { randomUUID } from 'crypto';

const WA_LINK_TTL_SECONDS = 15 * 60; // 15 minutos — mantido em sincronia com api/wa-connect-public.js

export default async function handler(req, res) {
  if (cors(req, res, ['POST'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  await ensureTrackingSchema();

  const { instanceName, qr_base64, target_cliente_id } = req.body || {};
  if (!instanceName) return res.status(400).json({ error: 'instanceName obrigatório' });
  if (!qr_base64 || !String(qr_base64).startsWith('data:image/')) {
    return res.status(400).json({ error: 'QR Code inválido — gere o QR Code primeiro.' });
  }

  // Mesmo prefixo de isolamento multi-tenant usado em api/evo-manager.js —
  // precisa ser idêntico, senão abre brecha de escopo entre clientes.
  const safeName = instanceName.replace(/[^a-zA-Z0-9_-]/g, '');
  const prefix = user.is_admin
    ? (target_cliente_id ? `cliente_${target_cliente_id}_` : 'admin_')
    : `cliente_${user.cliente_id}_`;
  const finalInstanceName = safeName.startsWith(prefix) ? safeName : `${prefix}${safeName}`;

  const clienteId = user.is_admin ? (target_cliente_id || null) : user.cliente_id;

  const pool = getPool();
  try {
    // Limpeza oportunista de links mortos — best-effort, não bloqueia a criação.
    try { await pool.query('DELETE FROM wa_connect_links WHERE expires_at < NOW()'); } catch (_) {}

    let token = null;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const candidato = randomUUID();
      const existe = await pool.query('SELECT 1 FROM wa_connect_links WHERE token=$1 LIMIT 1', [candidato]);
      if (!existe.rows.length) { token = candidato; break; }
    }
    if (!token) return res.status(500).json({ error: 'Não foi possível gerar o link agora. Tente novamente.' });

    const expiresAt = new Date(Date.now() + WA_LINK_TTL_SECONDS * 1000);

    await pool.query(
      `INSERT INTO wa_connect_links (token, instance_name, cliente_id, qr_base64, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, finalInstanceName, clienteId, qr_base64, user.id || null, expiresAt.toISOString()]
    );

    return res.status(200).json({ token, expires_at: expiresAt.toISOString() });
  } catch (error) {
    console.error('[wa-connect-share-create] erro:', error.message);
    return res.status(500).json({ error: 'Erro ao gerar o link de compartilhamento.' });
  }
}
