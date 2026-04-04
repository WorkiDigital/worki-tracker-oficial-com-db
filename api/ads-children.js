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

  const { level, parentId, datePreset = 'last_30d' } = req.query;
  const token = await getTokenForUser(user);

  if (!token)    return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!parentId) return res.status(400).json({ error: 'parentId is required' });
  if (!['adsets', 'ads'].includes(level))
    return res.status(400).json({ error: 'level must be adsets or ads' });

  // ── Cache hit? ────────────────────────────────────────────────
  const ck = cacheKey('children', level, parentId, datePreset);
  const cached = await cacheGet(ck);
  if (cached) return res.status(200).json(cached);

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,cost_per_action_type';
  const fields = `name,status,insights.date_preset(${datePreset}){${insightFields}}`;

  try {
    // ── Paginação completa ──────────────────────────────────────
    const allItems = [];
    let url = `https://graph.facebook.com/v20.0/${parentId}/${level}?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;
    while (url) {
      const r = await fetchMeta(url);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      allItems.push(...(data.data || []));
      url = data.paging?.next || null;
    }

    const result = { data: allItems };
    await cacheSet(ck, result, 60000); // 60s TTL
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
