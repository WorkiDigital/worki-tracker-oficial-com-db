import { verifyAuth, getTokenForUser } from './_auth.js';
import { normalizeAccountId, verifyAccountAccess } from './_validate.js';
import { cacheGet, cacheSet, cacheKey } from './_cache.js';
import { fetchMeta } from './_meta-client.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const { level, parentId, accountId, datePreset = 'last_30d' } = req.query;
  const token = await getTokenForUser(user);

  if (!token)    return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!parentId) return res.status(400).json({ error: 'parentId is required' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!(await verifyAccountAccess(user, accountId))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });
  if (!['adsets', 'ads'].includes(level))
    return res.status(400).json({ error: 'level must be adsets or ads' });

  // ── Cache hit? ────────────────────────────────────────────────
  const ck = cacheKey('children', accountId, level, parentId, datePreset);
  const cached = await cacheGet(ck);
  if (cached) return res.status(200).json(cached);

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,action_values,cost_per_action_type,purchase_roas';
  const budgetFields = level === 'adsets' ? ',daily_budget,lifetime_budget' : '';
  const fields = `name,status${budgetFields},insights.date_preset(${datePreset}){${insightFields}}`;

  try {
    const parentCheck = await fetchMeta(`https://graph.facebook.com/v20.0/${parentId}?fields=account_id&access_token=${token}`);
    const parentData = await parentCheck.json();
    if (parentData.error || normalizeAccountId(parentData.account_id) !== normalizeAccountId(accountId)) {
      return res.status(403).json({ error: 'Parent não pertence à conta informada.' });
    }

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
