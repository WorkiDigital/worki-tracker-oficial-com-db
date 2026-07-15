// GET /api/wa-connect-public?token=<token>
// Endpoint PÚBLICO (sem login) — só leitura. Mostra o QR Code já gerado pelo
// painel e informa se a instância já conectou. Nunca aceita nome de instância
// livre (só o token opaco), nunca implementa nenhuma ação de escrita
// (create/delete/logout/connect/link/unlink não existem aqui).
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { rateLimitByIp } from './_rate-limit-ip.js';
import { ensureTrackingSchema } from './_tracking-schema.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;
  if (await rateLimitByIp(req, res)) return;

  await ensureTrackingSchema();

  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Link inválido.' });

  const pool = getPool();
  try {
    const r = await pool.query(
      'SELECT instance_name, qr_base64, expires_at, used_at FROM wa_connect_links WHERE token = $1',
      [token]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Link não encontrado ou inválido.' });

    const row = r.rows[0];
    if (row.used_at) {
      return res.status(403).json({ error: 'Este link já foi utilizado. Peça um novo link.' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Este link expirou. Peça um novo link.' });
    }

    // Consulta de status SOMENTE LEITURA na Evolution — a chave da API nunca
    // é exposta ao público, fica só neste servidor. Se conectar, consome o
    // token (uso único) e avisa o público que já pode parar de escanear.
    let connected = false;
    try {
      const EVO_URL = process.env.EVOLUTION_API_URL;
      const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
      if (EVO_URL && EVO_KEY) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        try {
          const evoRes = await fetch(`${EVO_URL}/instance/connectionState/${row.instance_name}`, {
            headers: { apikey: EVO_KEY },
            signal: ctrl.signal,
          });
          if (evoRes.ok) {
            const data = await evoRes.json();
            const state = String(data?.instance?.state || data?.state || '').toLowerCase();
            connected = ['open', 'connected', 'online'].includes(state);
          }
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (_) {
      // Evolution fora do ar/lenta não deve derrubar a resposta — só não
      // confirma conexão ainda, o polling da página pública tenta de novo.
    }

    if (connected) {
      await pool.query('UPDATE wa_connect_links SET used_at = NOW() WHERE token = $1', [token]);
    }

    return res.status(200).json({
      qr_base64: row.qr_base64,
      expires_at: row.expires_at,
      connected,
    });
  } catch (error) {
    console.error('[wa-connect-public] erro:', error.message);
    return res.status(500).json({ error: 'Erro ao consultar o link.' });
  }
}
