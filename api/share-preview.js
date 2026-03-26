import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, adId } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!adId)  return res.status(400).json({ error: 'adId required' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: row, error } = await sb
    .from('share_tokens').select('account_id,expires_at').eq('token', token).single();
  if (error || !row) return res.status(404).json({ error: 'Link inválido' });
  if (row.expires_at && new Date(row.expires_at) < new Date())
    return res.status(403).json({ error: 'Link expirado' });

  const metaToken = process.env.META_ADS_TOKEN;
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });

  try {
    const url = `https://graph.facebook.com/v20.0/${adId}/previews?ad_format=MOBILE_FEED_STANDARD&access_token=${metaToken}`;
    const r    = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    return res.status(200).json({ body: data.data?.[0]?.body || null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
