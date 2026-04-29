import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { verifySharedAdAccount } from './_validate.js';

function safePreviewBody(raw) {
  const match = String(raw || '').match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (!match) return null;
  const srcRaw = match[1].replace(/&amp;/g, '&');
  try {
    const url = new URL(srcRaw);
    const host = url.hostname.toLowerCase();
    const allowed = url.protocol === 'https:' && (host === 'facebook.com' || host.endsWith('.facebook.com'));
    if (!allowed) return null;
    const src = url.toString().replace(/"/g, '&quot;');
    return `<iframe src="${src}" style="border:none;border-radius:10px;display:block;max-width:100%;" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"></iframe>`;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;

  const { token, adId } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!adId)  return res.status(400).json({ error: 'adId required' });
  if (!/^\d+$/.test(String(adId))) return res.status(400).json({ error: 'adId inválido' });

  const pool = getPool();
  let row;
  try {
    const { rows } = await pool.query(
      `SELECT st.account_id, st.expires_at, c.token_meta
       FROM share_tokens st
       LEFT JOIN usuarios u ON u.id = st.user_id
       LEFT JOIN clientes c ON c.id = u.cliente_id
       WHERE st.token = $1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Link inválido' });
    row = rows[0];
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar dados do link' });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date())
    return res.status(403).json({ error: 'Link expirado' });

  const metaToken = row.token_meta || process.env.META_ADS_TOKEN;
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });
  if (!(await verifySharedAdAccount(metaToken, adId, row.account_id))) {
    return res.status(403).json({ error: 'Anúncio não pertence a este link.' });
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${adId}/previews?ad_format=MOBILE_FEED_STANDARD&access_token=${metaToken}`;
    const r    = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    return res.status(200).json({ body: safePreviewBody(data.data?.[0]?.body) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
