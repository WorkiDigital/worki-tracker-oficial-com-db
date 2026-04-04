/**
 * GET /api/share-placement?token=&datePreset=&campaignIds=
 * Endpoint público (token) para posicionamento.
 * Usa level=ad + breakdowns=publisher_platform,platform_position para obter actions.
 * Agrega os resultados por platform_position.
 */
import { getPool } from './_db.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;

  const VALID_PRESETS = ['today','yesterday','last_7d','last_14d','last_30d','this_month','last_month','maximum'];
  const { token, datePreset = 'last_30d', campaignIds = '' } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!VALID_PRESETS.includes(datePreset)) return res.status(400).json({ error: 'datePreset inválido' });

  const pool = getPool();
  let row;
  try {
    const { rows } = await pool.query(
      `SELECT account_id, expires_at FROM share_tokens WHERE token = $1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Link inválido ou expirado' });
    row = rows[0];
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar dados do link' });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(403).json({ error: 'Este link expirou' });

  const metaToken = process.env.META_ADS_TOKEN;
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });

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
    `https://graph.facebook.com/v20.0/${row.account_id}/insights`,
    `?fields=${encodeURIComponent(fields)}`,
    `&level=ad`,
    `&breakdowns=publisher_platform%2Cplatform_position`,
    `&date_preset=${encodeURIComponent(preset)}`,
    `&limit=500`,
    filtering,
    `&access_token=${metaToken}`,
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

      for (const act of (row.actions || [])) {
        const existing = agg[pos].actions.find(a => a.action_type === act.action_type);
        if (existing) {
          existing.value = String(parseFloat(existing.value || 0) + parseFloat(act.value || 0));
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
