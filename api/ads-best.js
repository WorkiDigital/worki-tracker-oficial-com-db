import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { accountId, datePreset = 'last_30d' } = req.query;
  const token = process.env.META_ADS_TOKEN;
  if (!token)     return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,cost_per_action_type';
  const fields = [
    'name', 'status', 'effective_status',
    'campaign_id', 'campaign{name}',
    'adset_id', 'adset{name}',
    'creative{thumbnail_url,image_url,object_type,video_id}',
    `insights.date_preset(${datePreset}){${insightFields}}`,
  ].join(',');

  const url = `https://graph.facebook.com/v20.0/${accountId}/ads?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;

  try {
    const todos = [];
    let next = url;
    while (next) {
      const r    = await fetch(next);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      todos.push(...(data.data || []));
      next = data.paging?.next || null;
    }

    return res.status(200).json({ data: todos });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
