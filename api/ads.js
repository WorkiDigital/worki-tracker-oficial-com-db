import { verifyAuth, getTokenForUser } from './_auth.js';
import { verifyAccountAccess } from './_validate.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { datePreset = 'last_30d', accountId, dateFrom, dateTo } = req.query;
  const token = await getTokenForUser(user);

  if (!token) return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!(await verifyAccountAccess(user, accountId))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });

  // Campos de insight: spend, impressions, clicks (todos), outbound_clicks (cliques em links),
  // ctr, reach, actions (conversões, leads, mensagens, seguidores)
  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,cost_per_action_type';
  const insightsParam = (dateFrom && dateTo)
    ? `insights.time_range({"since":"${dateFrom}","until":"${dateTo}"})`
    : `insights.date_preset(${datePreset})`;
  const fields = `name,status,objective,${insightsParam}{${insightFields}}`;
  const url = `https://graph.facebook.com/v20.0/${accountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
