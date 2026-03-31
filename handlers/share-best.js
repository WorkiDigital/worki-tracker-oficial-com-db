import { getPool } from '../api/_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const VALID_PRESETS = ['today','yesterday','last_7d','last_14d','last_30d','this_month','last_month','maximum'];
  const { token, datePreset = 'today' } = req.query;
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

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,cost_per_action_type';
  const fields = [
    'name', 'status', 'effective_status',
    'campaign_id', 'campaign{name}',
    'adset_id', 'adset{name}',
    'creative{thumbnail_url,image_url,object_type,video_id}',
    `insights.date_preset(${datePreset}){${insightFields}}`,
  ].join(',');

  const url = `https://graph.facebook.com/v20.0/${row.account_id}/ads?fields=${encodeURIComponent(fields)}&limit=200&access_token=${metaToken}`;

  try {
    const todos = [];
    let next = url;
    while (next) {
      const r = await fetch(next);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      todos.push(...(data.data || []));
      next = data.paging?.next || null;
    }

    return res.status(200).json({ data: todos });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
