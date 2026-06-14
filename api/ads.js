import { verifyAuth, getTokenForUser } from './_auth.js';
import { verifyAccountAccess } from './_validate.js';
import { cacheGet, cacheSet, cacheKey } from './_cache.js';
import { fetchMeta } from './_meta-client.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const { datePreset = 'last_30d', accountId, dateFrom, dateTo } = req.query;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (dateFrom && !dateRegex.test(dateFrom)) return res.status(400).json({ error: 'dateFrom inválido. Use formato YYYY-MM-DD.' });
  if (dateTo && !dateRegex.test(dateTo)) return res.status(400).json({ error: 'dateTo inválido. Use formato YYYY-MM-DD.' });

  const validPresets = new Set(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d', 'this_month', 'last_month', 'this_quarter', 'maximum']);
  if (!validPresets.has(datePreset)) return res.status(400).json({ error: 'datePreset inválido.' });

  const token = await getTokenForUser(user);

  if (!token) return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!(await verifyAccountAccess(user, accountId))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });

  // Campos de insight: spend, impressions, clicks (todos), outbound_clicks (cliques em links),
  // ctr, reach, actions (conversões, leads, mensagens, seguidores)
  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,action_values,cost_per_action_type,purchase_roas,instagram_profile_visits,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_3_sec_watched_actions,inline_post_engagement';
  const insightsParam = (dateFrom && dateTo)
    ? `insights.time_range({"since":"${dateFrom}","until":"${dateTo}"})`
    : `insights.date_preset(${datePreset})`;
  const fields = `name,status,objective,${insightsParam}{${insightFields}}`;

  // ── Cache hit? ────────────────────────────────────────────────
  const ck = cacheKey('ads', accountId, datePreset, dateFrom, dateTo);
  const cached = await cacheGet(ck);
  if (cached) return res.status(200).json(cached);

  try {
    // ── Paginação completa ──────────────────────────────────────
    const allCampaigns = [];
    let url = `https://graph.facebook.com/v20.0/${accountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;
    while (url) {
      const r = await fetchMeta(url);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      allCampaigns.push(...(data.data || []));
      url = data.paging?.next || null;
    }
    const result = { data: allCampaigns };
    await cacheSet(ck, result, 60000); // 60s TTL
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
