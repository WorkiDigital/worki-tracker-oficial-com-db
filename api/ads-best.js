import { verifyAuth, getTokenForUser } from './_auth.js';
import { verifyAccountAccess } from './_validate.js';
import { cacheGet, cacheSet, cacheKey } from './_cache.js';
import { fetchMeta } from './_meta-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { accountId, datePreset = 'last_30d', dateFrom, dateTo } = req.query;
  const token = await getTokenForUser(user);
  if (!token) return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!(await verifyAccountAccess(user, accountId))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });

  // ── Cache hit? ────────────────────────────────────────────────
  const ck = cacheKey('best', accountId, datePreset, dateFrom, dateTo);
  const cached = await cacheGet(ck);
  if (cached) return res.status(200).json(cached);

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,cost_per_action_type';
  const insightsParam = (dateFrom && dateTo)
    ? `insights.time_range({"since":"${dateFrom}","until":"${dateTo}"})`
    : `insights.date_preset(${datePreset})`;
  const fields = [
    'name', 'status', 'effective_status',
    'campaign_id', 'campaign{name}',
    'adset_id', 'adset{name}',
    'creative{thumbnail_url,image_url,object_type,video_id}',
    `${insightsParam}{${insightFields}}`,
  ].join(',');

  const url = `https://graph.facebook.com/v20.0/${accountId}/ads?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;

  try {
    const todos = [];
    let next = url;
    while (next) {
      const r    = await fetchMeta(next);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      todos.push(...(data.data || []));
      next = data.paging?.next || null;
    }

    // Enriquecer criativos de vídeo com thumbnail HD + source
    const videoAds = todos.filter(ad => ad.creative?.video_id);
    for (let i = 0; i < videoAds.length; i += 10) {
      await Promise.all(videoAds.slice(i, i + 10).map(async ad => {
        try {
          const vUrl = `https://graph.facebook.com/v20.0/${ad.creative.video_id}?fields=source,thumbnails{uri,height,width}&access_token=${token}`;
          const vr = await fetchMeta(vUrl);
          const vd = await vr.json();
          if (vd.error) return;
          const thumbs = vd.thumbnails?.data || [];
          const best = thumbs.reduce((b, t) => (!b || t.height > b.height) ? t : b, null);
          if (best?.uri) ad.creative._hd_thumbnail = best.uri;
          if (vd.source)  ad.creative._video_source = vd.source;
        } catch { /* ignora */ }
      }));
    }

    const result = { data: todos };
    await cacheSet(ck, result, 90000); // 90s TTL
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
