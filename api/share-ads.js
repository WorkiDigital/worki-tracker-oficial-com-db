import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { decryptToken } from './_crypto.js';

const DEFAULT_SECTIONS = { campanhas: true, demograficos: true, melhores_criativos: true };
const DEFAULT_METRICS  = ['spend','imps','reach','cpm','ctr','leads','cpl','msgs','cpr','active_campaigns'];
const DEFAULT_COLUMNS  = ['status','spend','imps','reach','cpm','clicks','ctr','leads','cpl','msgs','cpr'];

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;

  const VALID_PRESETS = ['today','yesterday','last_7d','last_14d','last_30d','this_month','last_month','maximum'];
  const { token, datePreset = 'today' } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!VALID_PRESETS.includes(datePreset)) return res.status(400).json({ error: 'datePreset inválido' });

  const pool = getPool();
  let row;
  try {
    const { rows } = await pool.query(
      `SELECT st.account_id, st.account_name, st.client_name, st.visible_sections, st.visible_metrics, st.visible_columns, st.status_filter, st.currency, st.expires_at, c.token_meta, c.token_meta_enc
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
    try { metaToken = decryptToken(row.token_meta_enc); } catch (e) { console.error('[SHARE-ADS] Erro descriptografia', e.message); }
  }
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });

  const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,action_values,cost_per_action_type,purchase_roas';
  const fields = `name,status,objective,insights.date_preset(${datePreset}){${insightFields}}`;
  const url = `https://graph.facebook.com/v20.0/${row.account_id}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${metaToken}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    return res.status(200).json({
      ...data,
      account_name: row.account_name,
      client_name: row.client_name || row.account_name,
      currency: row.currency || 'BRL',
      config: {
        visible_sections: row.visible_sections || DEFAULT_SECTIONS,
        visible_metrics:  row.visible_metrics  || DEFAULT_METRICS,
        visible_columns:  row.visible_columns  || DEFAULT_COLUMNS,
        status_filter:    row.status_filter    || 'ACTIVE',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
