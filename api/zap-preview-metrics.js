import { verifyAuth, getTokenForUser } from './_auth.js';
import { verifyAccountAccess } from './_validate.js';
import { cacheGet, cacheSet, userCacheKey } from './_cache.js';
import { fetchMeta } from './_meta-client.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';
import { normalizeCampaignFilters, summarizeZapCampaigns } from './_zap-report-metrics.js';

export default async function handler(req, res) {
    if (cors(req, res, ['GET'])) return;

    const user = await verifyAuth(req, res);
    if (!user) return;
    if (await rateLimit(req, res, user)) return;

    const token = await getTokenForUser(user);
    if (!token) return res.status(403).json({ error: 'Token Meta nao configurado.' });

    const { account_id, periodo } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id obrigatorio' });
    if (!(await verifyAccountAccess(user, account_id))) {
        return res.status(403).json({ error: 'Acesso negado a esta conta de anuncios.' });
    }

    const periodoMap = {
        yesterday: 'yesterday', last_7_days: 'last_7d', last_14_days: 'last_14d',
        last_30_days: 'last_30d', current_month: 'this_month', previous_month: 'last_month',
    };
    const datePreset = periodoMap[periodo] || 'yesterday';
    const acctId = String(account_id).replace(/^act_/, '');
    const filters = normalizeCampaignFilters(req.query);
    const cacheKey = userCacheKey(
        user,
        'zap-preview-metrics',
        acctId,
        datePreset,
        filters.text,
        filters.objectives.join('|')
    );
    const cached = await cacheGet(cacheKey);
    if (cached) return res.status(200).json(cached);

    const insightFields = 'spend,impressions,clicks,reach,cpm,cpc,actions,purchase_roas';
    const fields = `name,status,objective,insights.date_preset(${datePreset}){${insightFields}}`;
    const url = `https://graph.facebook.com/v20.0/act_${acctId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;

    try {
        let allCampaigns = [], nextUrl = url;
        while (nextUrl) {
            const r = await fetchMeta(nextUrl);
            const data = await r.json();
            if (data.error) return res.status(400).json({ error: data.error.message });
            if (data.data) allCampaigns.push(...data.data);
            nextUrl = data.paging?.next || null;
        }

        const result = summarizeZapCampaigns(allCampaigns, filters);
        await cacheSet(cacheKey, result, 60000);
        return res.status(200).json(result);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}