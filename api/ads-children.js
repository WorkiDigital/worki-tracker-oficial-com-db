import { verifyAuth, getTokenForUser } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { level, parentId, datePreset = 'last_30d' } = req.query;
  const token = await getTokenForUser(user);

  if (!token)    return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });
  if (!parentId) return res.status(400).json({ error: 'parentId is required' });
  if (!['adsets', 'ads'].includes(level))
    return res.status(400).json({ error: 'level must be adsets or ads' });

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,cost_per_action_type';
  const fields = `name,status,insights.date_preset(${datePreset}){${insightFields}}`;
  const url = `https://graph.facebook.com/v20.0/${parentId}/${level}?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
