import { verifyAuth, getTokenForUser } from './_auth.js';
import { verifyAccountAccess } from './_validate.js';
import { cacheGet, cacheSet, cacheKey } from './_cache.js';
import { fetchMeta } from './_meta-client.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PRESETS = new Set(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d', 'this_month', 'last_month', 'this_quarter', 'maximum']);
const VALID_STATUSES = new Set(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES']);
const MAX_CAMPAIGN_IDS = 100;
const MAX_BEST_PAGES = 5;
const META_BEST_TIMEOUT_MS = 12000;
const META_BEST_RETRIES = 1;

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const { accountId, datePreset = 'last_30d', dateFrom, dateTo, campaignIds, status } = req.query;
  if (dateFrom && !DATE_RE.test(dateFrom)) return res.status(400).json({ error: 'dateFrom invalido. Use formato YYYY-MM-DD.' });
  if (dateTo && !DATE_RE.test(dateTo)) return res.status(400).json({ error: 'dateTo invalido. Use formato YYYY-MM-DD.' });
  if (!VALID_PRESETS.has(datePreset)) return res.status(400).json({ error: 'datePreset invalido.' });
  if (status && !VALID_STATUSES.has(status)) return res.status(400).json({ error: 'status invalido.' });

  const campaignIdList = typeof campaignIds === 'string' && campaignIds.trim()
    ? campaignIds.split(',').map(id => id.trim()).filter(Boolean)
    : [];
  if (campaignIdList.some(id => !/^\d+$/.test(id))) return res.status(400).json({ error: 'campaignIds invalido.' });
  const scopedCampaignIds = campaignIdList.slice(0, MAX_CAMPAIGN_IDS);

  const token = await getTokenForUser(user);
  if (!token) return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!(await verifyAccountAccess(user, accountId))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });

  // ── Cache hit? ────────────────────────────────────────────────
  const ck = cacheKey('best', accountId, datePreset, dateFrom, dateTo, status || '', scopedCampaignIds.join('|'));
  const cached = await cacheGet(ck);
  if (cached) return res.status(200).json(cached);

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,action_values,cost_per_action_type,purchase_roas';
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

  const filtering = [];
  if (status) {
    filtering.push({ field: 'effective_status', operator: 'IN', value: [status] });
  }
  if (scopedCampaignIds.length) {
    filtering.push({ field: 'campaign.id', operator: 'IN', value: scopedCampaignIds });
  }
  const filteringQs = filtering.length
    ? `&filtering=${encodeURIComponent(JSON.stringify(filtering))}`
    : '';
  const url = `https://graph.facebook.com/v20.0/${accountId}/ads?fields=${encodeURIComponent(fields)}&limit=100${filteringQs}&access_token=${token}`;

  try {
    const todos = [];
    let next = url;
    let pages = 0;
    while (next && pages < MAX_BEST_PAGES) {
      const r    = await fetchMeta(next, { timeoutMs: META_BEST_TIMEOUT_MS, maxRetries: META_BEST_RETRIES });
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      todos.push(...(data.data || []));
      next = data.paging?.next || null;
      pages++;
    }

    const result = { data: todos, truncated: !!next };
    await cacheSet(ck, result, 90000); // 90s TTL
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
