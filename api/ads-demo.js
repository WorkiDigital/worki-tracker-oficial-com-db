/**
 * GET /api/ads-demo
 * Retorna breakdowns demográficos da Meta Ads.
 * Se o período selecionado não tiver dados, faz fallback automático para "maximum" (todo histórico).
 *
 * Query params:
 *   accountId    - ID da conta (obrigatório)
 *   datePreset   - Período (last_30d, today, last_7d, etc.)
 *   breakdown    - age | gender | publisher_platform | impression_device
 *   campaignIds  - IDs de campanhas separados por vírgula (opcional)
 *
 * Response:
 *   { data: [...], period: 'last_30d' | 'maximum' }
 */
import { verifyAuth, getTokenForUser } from './_auth.js';
import { verifyAccountAccess } from './_validate.js';

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
    breakdown   = 'age',
    campaignIds = '',
    dateFrom,
    dateTo,
  } = req.query;

  const token = await getTokenForUser(user);
  if (!token)     return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!(await verifyAccountAccess(user, accountId))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });

  const VALID = ['age', 'gender', 'publisher_platform', 'impression_device'];
  if (!VALID.includes(breakdown))
    return res.status(400).json({ error: 'breakdown inválido' });

  const fields = 'spend,impressions,clicks,actions';

  // Filtro por campanhas (quando usuário aplica filtros)
  let filtering = '';
  if (campaignIds) {
    const ids = campaignIds.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      filtering = `&filtering=${encodeURIComponent(JSON.stringify([
        { field: 'campaign.id', operator: 'IN', value: ids }
      ]))}`;
    }
  }

  const buildUrl = (preset, from, to) => {
    const datePart = (from && to)
      ? `&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}`
      : `&date_preset=${encodeURIComponent(preset)}`;
    return [
      `https://graph.facebook.com/v20.0/${accountId}/insights`,
      `?fields=${encodeURIComponent(fields)}`,
      `&breakdowns=${encodeURIComponent(breakdown)}`,
      datePart,
      `&limit=500`,
      filtering,
      `&access_token=${token}`,
    ].join('');
  };

  try {
    // Tentativa 1: período selecionado
    let r    = await fetch(buildUrl(datePreset, dateFrom, dateTo));
    let json = await r.json();
    if (json.error) return res.status(400).json({ error: json.error.message });

    // Fallback para "maximum" se não houver dados no período (apenas para presets, não para custom)
    let usedPeriod = datePreset;
    if (!json.data || json.data.length === 0) {
      if (dateFrom && dateTo) {
        return res.status(200).json({ data: [], usedPeriod: 'custom' });
      }
      r    = await fetch(buildUrl('maximum'));
      json = await r.json();
      if (json.error) return res.status(400).json({ error: json.error.message });
      usedPeriod = 'maximum';
    }

    return res.status(200).json({
      data: json.data || [],
      period: usedPeriod,   // frontend usa isso para mostrar aviso quando for fallback
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
