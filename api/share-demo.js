import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const VALID_PRESETS = ['today','yesterday','last_7d','last_14d','last_30d','this_month','last_month','maximum'];
  const VALID_BREAKDOWNS = ['age', 'gender', 'publisher_platform', 'impression_device', 'platform_position'];
  const { token, datePreset = 'today', breakdown = 'age', campaignIds = '' } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!VALID_PRESETS.includes(datePreset)) return res.status(400).json({ error: 'datePreset inválido' });
  if (!VALID_BREAKDOWNS.includes(breakdown)) return res.status(400).json({ error: 'breakdown inválido' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: row, error } = await sb
    .from('share_tokens').select('account_id,expires_at').eq('token', token).single();

  if (error || !row) return res.status(404).json({ error: 'Link inválido ou expirado' });
  if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(403).json({ error: 'Este link expirou' });

  const metaToken = process.env.META_ADS_TOKEN;
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });

  // platform_position não pode ser combinado com actions (action_type conflict)
  const fields = breakdown === 'platform_position'
    ? 'spend,impressions,clicks'
    : 'spend,impressions,clicks,actions';

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
    `&breakdowns=${encodeURIComponent(breakdown)}`,
    `&date_preset=${encodeURIComponent(preset)}`,
    `&limit=500`,
    filtering,
    `&access_token=${metaToken}`,
  ].join('');

  try {
    let r = await fetch(buildUrl(datePreset));
    let json = await r.json();
    if (json.error) return res.status(400).json({ error: json.error.message });

    let usedPeriod = datePreset;
    if (!json.data || json.data.length === 0) {
      r = await fetch(buildUrl('maximum'));
      json = await r.json();
      if (json.error) return res.status(400).json({ error: json.error.message });
      usedPeriod = 'maximum';
    }

    return res.status(200).json({ data: json.data || [], period: usedPeriod });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
