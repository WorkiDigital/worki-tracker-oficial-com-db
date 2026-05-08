import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();

  if (req.method === 'GET') {
    const { accountId } = req.query;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    try {
      const r = await pool.query(
        'SELECT metrics_cfg, demo_cfg FROM dashboard_settings WHERE user_id = $1 AND ad_account_id = $2',
        [user.id, accountId]
      );

      if (r.rows.length === 0) {
        return res.status(404).json({ message: 'Settings not found' });
      }

      return res.status(200).json(r.rows[0]);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    const { accountId, metricsCfg, demoCfg } = req.body;
    if (!accountId || !metricsCfg || !demoCfg) {
      return res.status(400).json({ error: 'accountId, metricsCfg, and demoCfg are required' });
    }

    try {
      // Upsert
      await pool.query(`
        INSERT INTO dashboard_settings (user_id, ad_account_id, metrics_cfg, demo_cfg, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, ad_account_id) DO UPDATE SET
          metrics_cfg = EXCLUDED.metrics_cfg,
          demo_cfg = EXCLUDED.demo_cfg,
          updated_at = NOW()
      `, [user.id, accountId, metricsCfg, demoCfg]);

      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
}
