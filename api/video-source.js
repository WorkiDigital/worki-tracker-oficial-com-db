import { verifyAuth, getTokenForUser } from './_auth.js';
import { cors } from './_cors.js';
import { verifyAccountAccess } from './_validate.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { videoId, adId, cliente_id } = req.query;
  const token = await getTokenForUser(user);
  if (!token)   return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });
  if (!/^\d+$/.test(String(videoId))) return res.status(400).json({ error: 'videoId inválido' });

  if (!user.is_admin || cliente_id) {
    if (!adId || !/^\d+$/.test(String(adId))) return res.status(400).json({ error: 'adId is required' });
    const check = await fetch(`https://graph.facebook.com/v20.0/${adId}?fields=account_id,creative{video_id}&access_token=${token}`);
    const ad = await check.json();
    if (ad.error || !(await verifyAccountAccess(user, ad.account_id, cliente_id))) {
      return res.status(403).json({ error: 'Acesso negado a este vídeo.' });
    }
    const creativeVideoId = ad.creative?.video_id ? String(ad.creative.video_id) : null;
    if (creativeVideoId !== String(videoId)) {
      return res.status(403).json({ error: 'Vídeo não pertence ao anúncio informado.' });
    }
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${videoId}?fields=source,thumbnails{uri,height,width}&access_token=${token}`;
    const r    = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    // Pick the largest thumbnail available
    const thumbs = data.thumbnails?.data || [];
    const bestThumb = thumbs.reduce((best, t) => (!best || t.height > best.height) ? t : best, null);
    return res.status(200).json({
      source:    data.source    || null,
      thumbnail: bestThumb?.uri || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
