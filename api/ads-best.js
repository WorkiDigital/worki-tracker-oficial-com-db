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
    'name', 'status',
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

    // Enrich video ads with HD thumbnails via Meta Batch API (groups of 50)
    const videoAds = todos.filter(ad => ad.creative?.video_id);
    for (let i = 0; i < videoAds.length; i += 50) {
      const chunk = videoAds.slice(i, i + 50);
      const batch = chunk.map(ad => ({
        method: 'GET',
        relative_url: `${ad.creative.video_id}?fields=thumbnails{uri,height,width}`,
      }));

      const form = new URLSearchParams();
      form.set('access_token', token);
      form.set('batch', JSON.stringify(batch));

      const br = await fetch('https://graph.facebook.com/v20.0/', {
        method: 'POST',
        body: form,
      });
      const results = await br.json();

      if (Array.isArray(results)) {
        results.forEach((result, idx) => {
          if (result?.code === 200) {
            try {
              const body = JSON.parse(result.body);
              const thumbs = body.thumbnails?.data || [];
              // Pick highest resolution thumbnail
              const best = thumbs.reduce((b, t) => (!b || t.height > b.height) ? t : b, null);
              if (best?.uri) chunk[idx].creative._hd_thumbnail = best.uri;
            } catch (_) { /* skip */ }
          }
        });
      }
    }

    return res.status(200).json({ data: todos });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
