import { verifyAuth, getTokenForUser } from './_auth.js';
import { verifyAccountAccess } from './_validate.js';
import { cacheGet, cacheSet, userCacheKey } from './_cache.js';
import { fetchMeta } from './_meta-client.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

export default async function handler(req, res) {
    if (cors(req, res, ['GET'])) return;

    const user = await verifyAuth(req, res);
    if (!user) return;
    if (await rateLimit(req, res, user)) return;

    const token = await getTokenForUser(user);
    if (!token) return res.status(403).json({ error: 'Token Meta não configurado.' });

    const { account_id, periodo } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id obrigatório' });
    if (!(await verifyAccountAccess(user, account_id))) {
        return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });
    }

    const periodoMap = {
        yesterday: 'yesterday', last_7_days: 'last_7d', last_14_days: 'last_14d',
        last_30_days: 'last_30d', current_month: 'this_month', previous_month: 'last_month',
    };
    const datePreset = periodoMap[periodo] || 'yesterday';
    const acctId = String(account_id).replace(/^act_/, '');
    const cacheKey = userCacheKey(user, 'zap-preview-metrics', acctId, datePreset);
    const cached = await cacheGet(cacheKey);
    if (cached) return res.status(200).json(cached);

    const insightFields = 'spend,impressions,clicks,reach,cpm,cpc,actions,purchase_roas';
    const fields = `name,status,insights.date_preset(${datePreset}){${insightFields}}`;
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

        let spend = 0, impressions = 0, clicks = 0, leads = 0, msgs = 0,
            reach = 0, roasValue = 0;

        for (const c of allCampaigns) {
            const ins = c.insights?.data?.[0];
            if (!ins) continue;
            spend       += parseFloat(ins.spend       || 0);
            impressions += parseInt(ins.impressions   || 0);
            clicks      += parseInt(ins.clicks        || 0);
            reach       += parseInt(ins.reach         || 0);
            for (const a of (ins.actions || [])) {
                if (a.action_type === 'lead') leads += parseInt(a.value || 0);
                if (a.action_type === 'onsite_conversion.messaging_conversation_started_7d')
                    msgs += parseInt(a.value || 0);
            }
            for (const r of (ins.purchase_roas || [])) {
                if (r.action_type === 'omni_purchase') roasValue += parseFloat(r.value || 0);
            }
        }

        const cpl  = leads      > 0 ? spend / leads      : 0;
        const cpr  = msgs       > 0 ? spend / msgs        : 0;
        const cpc  = clicks     > 0 ? spend / clicks      : 0;
        const cpm  = impressions > 0 ? (spend / impressions) * 1000 : 0;
        const ctr  = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const roas = spend      > 0 ? roasValue / spend   : 0;

        const result = { spend, impressions, clicks, reach, leads, msgs, cpl, cpr, cpc, cpm, ctr, roas };
        await cacheSet(cacheKey, result, 60000);
        return res.status(200).json(result);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
