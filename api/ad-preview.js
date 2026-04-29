import { verifyAuth, getTokenForUser } from './_auth.js';
import { cors } from './_cors.js';
import { verifyAdAccountAccess } from './_validate.js';

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
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { adId } = req.query;
  const token = await getTokenForUser(user);
  if (!token) return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!adId)  return res.status(400).json({ error: 'adId is required' });
  if (!/^\d+$/.test(String(adId))) return res.status(400).json({ error: 'adId inválido' });
  if (!(await verifyAdAccountAccess(user, token, adId))) return res.status(403).json({ error: 'Acesso negado a este anúncio.' });

  try {
    const url = `https://graph.facebook.com/v20.0/${adId}/previews?ad_format=MOBILE_FEED_STANDARD&access_token=${token}`;
    const r    = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const body = safePreviewBody(data.data?.[0]?.body);
    return res.status(200).json({ body });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
