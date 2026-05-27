import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { decryptToken } from './_crypto.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;

  const VALID_PRESETS = ['today','yesterday','last_7d','last_14d','last_30d','this_month','last_month','maximum'];
  const VALID_BREAKDOWNS = ['age', 'gender', 'publisher_platform', 'impression_device'];
  const { token, datePreset = 'today', breakdown = 'age', campaignIds = '' } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!VALID_PRESETS.includes(datePreset)) return res.status(400).json({ error: 'datePreset inválido' });
  if (!VALID_BREAKDOWNS.includes(breakdown)) return res.status(400).json({ error: 'breakdown inválido' });

  const pool = getPool();
  let row;
  try {
    const { rows } = await pool.query(
      `SELECT st.account_id, st.expires_at, c.token_meta, c.token_meta_enc
       FROM share_tokens st
       LEFT JOIN usuarios u ON u.id = st.user_id
       LEFT JOIN clientes c ON c.id = u.cliente_id
       WHERE st.token = $1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Link inválido ou expirado' });
    row = rows[0];
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar dados do link' });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(403).json({ error: 'Este link expirou' });

  let metaToken = row.token_meta || process.env.META_ADS_TOKEN;
  if (row.token_meta_enc) {
    try { metaToken = decryptToken(row.token_meta_enc); } catch (e) { console.error('[SHARE-DEMO] Erro descriptografia', e.message); }
  }
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });

  const fields = 'spend,impressions,clicks,actions';

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
