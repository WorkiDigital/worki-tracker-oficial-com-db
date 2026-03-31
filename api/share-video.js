import { getPool } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, videoId } = req.query;
  if (!token)   return res.status(400).json({ error: 'token required' });
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  // Validate videoId is numeric
  if (!/^\d+$/.test(videoId)) return res.status(400).json({ error: 'videoId inválido' });

  const pool = getPool();
  let row;
  try {
    const { rows } = await pool.query(
      `SELECT account_id, expires_at FROM share_tokens WHERE token = $1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Link inválido ou expirado' });
    row = rows[0];
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar dados do link' });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(403).json({ error: 'Este link expirou' });

  const metaToken = process.env.META_ADS_TOKEN;
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });

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
