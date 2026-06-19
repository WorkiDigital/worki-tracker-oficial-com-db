import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { ensureTrackingSchema } from './_tracking-schema.js';

// Métricas dos links rastreáveis: cliques, conversões, taxa, distribuição por número.
export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  await ensureTrackingSchema();
  const pool = getPool();
  const cliente_id = user.is_admin ? (req.query.cliente_id || user.cliente_id) : user.cliente_id;
  const campaignId = req.query.campaign_id || null;
  if (!cliente_id) {
    return res.status(400).json({ error: 'cliente_id é obrigatório para administrador.' });
  }

  try {
    const where = ['cliente_id = $1'];
    const params = [cliente_id];
    if (campaignId) { where.push(`campaign_id = $2`); params.push(campaignId); }
    const whereSql = where.join(' AND ');

    // Totais
    const tot = await pool.query(
      `SELECT
         COUNT(*) AS cliques,
         COUNT(*) FILTER (WHERE status='converted') AS conversoes,
         COUNT(*) FILTER (WHERE converted_at IS NOT NULL AND lead_id IS NOT NULL) AS leads
       FROM tracking_clicks WHERE ${whereSql}`,
      params
    );
    const t = tot.rows[0];
    const taxa = t.cliques > 0 ? Math.round((t.conversoes / t.cliques) * 1000) / 10 : 0;

    // Distribuição por número (destino)
    const dist = await pool.query(
      `SELECT whatsapp_number,
         COUNT(*) AS cliques,
         COUNT(*) FILTER (WHERE status='converted') AS conversoes
       FROM tracking_clicks WHERE ${whereSql}
       GROUP BY whatsapp_number ORDER BY cliques DESC`,
      params
    );

    // Por campanha (quando não filtra por uma só)
    const porCampanha = await pool.query(
      `SELECT c.id, c.name, c.slug,
         COUNT(k.*) AS cliques,
         COUNT(k.*) FILTER (WHERE k.status='converted') AS conversoes
       FROM tracking_campaigns c
       LEFT JOIN tracking_clicks k ON k.campaign_id = c.id
       WHERE c.cliente_id = $1
       GROUP BY c.id ORDER BY cliques DESC`,
      [cliente_id]
    );

    return res.status(200).json({
      totais: { cliques: parseInt(t.cliques), conversoes: parseInt(t.conversoes), leads: parseInt(t.leads), taxa_conversao: taxa },
      distribuicao_numeros: dist.rows,
      por_campanha: porCampanha.rows,
    });
  } catch (err) {
    console.error('[tracking-metrics]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
