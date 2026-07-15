import { verifyAuth, getTokenForUser } from './_auth.js';
import { verifyAccountAccess } from './_validate.js';
import { cacheGet, cacheSet, cacheKey } from './_cache.js';
import { fetchMeta } from './_meta-client.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';
import { requirePermission } from './_require-permission.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (requirePermission(user, res, 'anuncios')) return;
  if (await rateLimit(req, res, user)) return;

  const { datePreset = 'last_30d', accountId, dateFrom, dateTo, cliente_id } = req.query;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (dateFrom && !dateRegex.test(dateFrom)) return res.status(400).json({ error: 'dateFrom inválido. Use formato YYYY-MM-DD.' });
  if (dateTo && !dateRegex.test(dateTo)) return res.status(400).json({ error: 'dateTo inválido. Use formato YYYY-MM-DD.' });

  const validPresets = new Set(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d', 'this_month', 'last_month', 'this_quarter', 'maximum']);
  if (!validPresets.has(datePreset)) return res.status(400).json({ error: 'datePreset inválido.' });

  const token = await getTokenForUser(user);

  if (!token) return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!(await verifyAccountAccess(user, accountId, cliente_id))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });

  // Campos de insight. Hook Rate foi REMOVIDO: a API não expõe "reproduções de 3s"
  // (o numerador que o Gerenciador usa) — confirmado por debug, todos os campos
  // candidatos vinham 0. Mantemos só os percentis de vídeo (p25/50/75/100) que batem.
  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,action_values,cost_per_action_type,purchase_roas,instagram_profile_visits,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,inline_post_engagement';
  const insightsParam = (dateFrom && dateTo)
    ? `insights.time_range({"since":"${dateFrom}","until":"${dateTo}"})`
    : `insights.date_preset(${datePreset})`;
  const mkFields = (flds) => `name,status,objective,daily_budget,lifetime_budget,${insightsParam}{${flds}}`;
  const fields = mkFields(insightFields);

  // ── Cache hit? ────────────────────────────────────────────────
  const ck = cacheKey('ads', accountId, datePreset, dateFrom, dateTo);
  const cached = await cacheGet(ck);
  if (cached) return res.status(200).json(cached);

  // Busca as campanhas com paginação. Recebe a string de fields a usar.
  const buscarCampanhas = async (flds) => {
    const all = [];
    let url = `https://graph.facebook.com/v23.0/${accountId}/campaigns?fields=${encodeURIComponent(mkFields(flds))}&limit=200&access_token=${token}`;
    while (url) {
      const r = await fetchMeta(url);
      const data = await r.json();
      if (data.error) return { error: data.error };
      all.push(...(data.data || []));
      url = data.paging?.next || null;
    }
    return { data: all };
  };

  try {
    const resp = await buscarCampanhas(insightFields);
    if (resp.error) return res.status(400).json({ error: resp.error.message });

    const result = { data: resp.data };
    await cacheSet(ck, result, 60000); // 60s TTL
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
