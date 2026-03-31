/**
 * GET /api/ads-placement?accountId=&datePreset=&campaignIds=
 * Retorna dados de posicionamento da Meta Ads.
 * Usa level=ad + breakdowns=publisher_platform,platform_position para obter actions.
 * Agrega os resultados por platform_position (soma FB + IG + etc).
 */
import { verifyAuth, getTokenForUser } from '../api/_auth.js';
import { verifyAccountAccess } from '../api/_validate.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const {
    accountId,
    datePreset  = 'last_30d',
    campaignIds = '',
  } = req.query;

  const token = await getTokenForUser(user);
  if (!token)     return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!(await verifyAccountAccess(user, accountId))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });

  const fields = 'spend,impressions,clicks,inline_link_clicks,actions';

  let filtering = '';
  if (campaignIds) {
    const ids = campaignIds.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      filtering = `&filtering=${encodeURIComponent(JSON.stringify([
        { field: 'campaign.id', operator: 'IN', value: ids }
      ]))}`;
    }
  }

  const buildUrl = (preset) => [
    `https://graph.facebook.com/v20.0/${accountId}/insights`,
    `?fields=${encodeURIComponent(fields)}`,
    `&level=ad`,
    `&breakdowns=publisher_platform%2Cplatform_position`,
    `&date_preset=${encodeURIComponent(preset)}`,
    `&limit=500`,
    filtering,
    `&access_token=${token}`,
  ].join('');

  try {
    let r    = await fetch(buildUrl(datePreset));
    let json = await r.json();
    if (json.error) return res.status(400).json({ error: json.error.message });

    let usedPeriod = datePreset;
    if (!json.data || json.data.length === 0) {
      r    = await fetch(buildUrl('maximum'));
      json = await r.json();
      if (json.error) return res.status(400).json({ error: json.error.message });
      usedPeriod = 'maximum';
    }

    // Agregar por platform_position (soma publisher_platforms diferentes)
    const agg = {};
    for (const row of (json.data || [])) {
      const pos = row.platform_position;
      if (!pos) continue;
      if (!agg[pos]) {
        agg[pos] = { platform_position: pos, spend: 0, impressions: 0, clicks: 0, inline_link_clicks: 0, actions: [] };
      }
      agg[pos].spend        += parseFloat(row.spend        || 0);
      agg[pos].impressions  += parseInt(row.impressions    || 0, 10);
      agg[pos].clicks       += parseInt(row.clicks         || 0, 10);
      agg[pos].inline_link_clicks += parseInt(row.inline_link_clicks || 0, 10);

      // Mesclar actions
      for (const act of (row.actions || [])) {
        const existing = agg[pos].actions.find(a => a.action_type === act.action_type);
        if (existing) {
          existing.value = String(parseFloat(existing.value) + parseFloat(act.value || 0));
        } else {
          agg[pos].actions.push({ action_type: act.action_type, value: act.value });
        }
      }
    }

    const data = Object.values(agg).sort((a, b) => b.spend - a.spend);

    return res.status(200).json({ data, period: usedPeriod });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
