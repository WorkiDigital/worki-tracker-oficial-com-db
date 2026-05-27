import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { verifySharedAdVideo } from './_validate.js';
import { decryptToken } from './_crypto.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;

  const { token, videoId, adId } = req.query;
  if (!token)   return res.status(400).json({ error: 'token required' });
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  // Validate videoId is numeric
  if (!/^\d+$/.test(videoId)) return res.status(400).json({ error: 'videoId inválido' });

  const pool = getPool();
  let row;
  try {
    const { rows } = await pool.query(
      `SELECT st.account_id, st.expires_at, c.token_meta, c.token_meta_enc
       FROM share_tokens st
       LEFT JOIN usuarios u ON u.id = st.user_id
       LEFT JOIN clientes c ON c.id = u.cliente_id
       WHERE st.token = $1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Link inválido ou expirado' });
    row = rows[0];
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar dados do link' });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(403).json({ error: 'Este link expirou' });

  let metaToken = row.token_meta || process.env.META_ADS_TOKEN;
  if (row.token_meta_enc) {
    try { metaToken = decryptToken(row.token_meta_enc); } catch (e) { console.error('[SHARE-VIDEO] Erro descriptografia', e.message); }
  }
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });
  if (!(await verifySharedAdVideo(metaToken, adId, videoId, row.account_id))) {
    return res.status(403).json({ error: 'Vídeo não pertence a este link.' });
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${videoId}?fields=source,thumbnails{uri,height,width},permalink_url&access_token=${metaToken}`;
    const r    = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    const thumbs   = data.thumbnails?.data || [];
    const bestThumb = thumbs.reduce((best, t) => (!best || t.height > best.height) ? t : best, null);

    return res.status(200).json({
      source:        data.source        || null,
      thumbnail:     bestThumb?.uri     || null,
      permalink_url: data.permalink_url || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
