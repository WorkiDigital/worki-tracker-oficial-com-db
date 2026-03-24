import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, datePreset = 'today' } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: row, error } = await sb
    .from('share_tokens').select('account_id,account_name').eq('token', token).single();

  if (error || !row) return res.status(404).json({ error: 'Link inválido ou expirado' });

  const metaToken = process.env.META_ADS_TOKEN;
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,cost_per_action_type';
  const fields = `name,status,objective,insights.date_preset(${datePreset}){${insightFields}}`;
  const url = `https://graph.facebook.com/v20.0/${row.account_id}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${metaToken}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    return res.status(200).json({ ...data, account_name: row.account_name });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
