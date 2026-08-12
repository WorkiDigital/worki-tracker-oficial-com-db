// GET /api/wa-connect-public?token=<token>
// Endpoint PÚBLICO (sem login) — só leitura de status + renovação do QR.
// Mostra o QR Code já gerado pelo painel e informa se a instância já
// conectou. Nunca aceita nome de instância livre (só o token opaco), nunca
// implementa nenhuma ação de escrita alheia à própria renovação do QR
// (create/delete/logout/link/unlink não existem aqui).
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { rateLimitByIp } from './_rate-limit-ip.js';
import { ensureTrackingSchema } from './_tracking-schema.js';

// Vida do LINK (a página pública pode ficar aberta por bem mais tempo que um
// QR individual — quando o QR expira, o próprio endpoint busca um novo na
// Evolution, mesmo mecanismo que o painel usa via checkWaStatus). Vida do QR
// em si continua curta (mesma estimativa de sempre), só não derruba o link.
const WA_LINK_TTL_SECONDS = 24 * 60 * 60; // 24 horas
const WA_QR_TTL_SECONDS = 10 * 60; // 10 minutos (600s)

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;
  if (await rateLimitByIp(req, res)) return;

  await ensureTrackingSchema();

  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Link inválido.' });

  const pool = getPool();
  try {
    const r = await pool.query(
      'SELECT instance_name, qr_base64, expires_at, used_at, created_at FROM wa_connect_links WHERE token = $1',
      [token]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Link não encontrado ou inválido.' });

    let row = r.rows[0];
    if (row.used_at) {
      return res.status(403).json({ error: 'Este link já foi utilizado. Peça um novo link.' });
    }
    // expires_at é a validade do LINK inteiro (24h). Links antigos criados antes
    // desta mudança entram pelo expires_at gravado no banco.
    if (new Date(row.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Este link expirou. Peça um novo link.' });
    }

    // QR individual expira bem antes do link (estimativa de UX, mesma usada
    // no painel — a Evolution não retorna expiração real). Quando vence,
    // busca um QR novo na Evolution e atualiza o registro — a chave da API
    // nunca é exposta ao público, essa troca acontece só neste servidor.
    const qrExpiraEm = new Date(new Date(row.created_at).getTime() + WA_QR_TTL_SECONDS * 1000);
    if (qrExpiraEm < new Date()) {
      try {
        const EVO_URL = process.env.EVOLUTION_API_URL;
        const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
        if (EVO_URL && EVO_KEY) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          try {
            const evoRes = await fetch(`${EVO_URL}/instance/connect/${row.instance_name}`, {
              headers: { apikey: EVO_KEY },
              signal: ctrl.signal,
            });
            if (evoRes.ok) {
              const data = await evoRes.json();
              let newQr = data?.base64 || data?.qrcode?.base64 || data?.code;
              if (newQr) {
                if (!newQr.startsWith('data:image/')) {
                  newQr = `data:image/png;base64,${newQr}`;
                }
                await pool.query(
                  'UPDATE wa_connect_links SET qr_base64 = $1, created_at = NOW() WHERE token = $2',
                  [newQr, token]
                );
                row = { ...row, qr_base64: newQr, created_at: new Date().toISOString() };
              }
            }
          } finally {
            clearTimeout(timer);
          }
        }
      } catch (_) {
        // Falha ao renovar não deve derrubar a resposta — devolve o QR antigo
        // (o front mostra "expirado" no countdown, mas o polling tenta de novo).
      }
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
      // qr_expires_at: quando ESTE qr_base64 fica velho (renova sozinho no
      // próximo poll). link_expires_at: quando a página inteira para de
      // funcionar (uso único ou tempo total esgotado).
      qr_expires_at: new Date(new Date(row.created_at).getTime() + WA_QR_TTL_SECONDS * 1000).toISOString(),
      link_expires_at: row.expires_at,
      connected,
    });
  } catch (error) {
    console.error('[wa-connect-public] erro:', error.message);
    return res.status(500).json({ error: 'Erro ao consultar o link.' });
  }
}
