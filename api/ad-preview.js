import { verifyAuth, getTokenForUser } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { adId } = req.query;
  const token = await getTokenForUser(user);
  if (!token) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });
  if (!adId)  return res.status(400).json({ error: 'adId is required' });

  try {
    const url = `https://graph.facebook.com/v20.0/${adId}/previews?ad_format=MOBILE_FEED_STANDARD&access_token=${token}`;
    const r    = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const body = data.data?.[0]?.body || null;
    return res.status(200).json({ body });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
