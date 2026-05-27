import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  // Em produção, isso pode ser chamado por um CRON externo ou pelo dashboard admin
  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const cliente_id = user.is_admin ? req.query.cliente_id : user.cliente_id;

  try {
    const whereClause = cliente_id ? 'AND cliente_id = $1' : '';
    const params = cliente_id ? [cliente_id] : [];

    // 1. Leads sem resposta há mais de 2h (Status: novo)
    const slowResponse = await pool.query(`
      SELECT id, nome, telefone, created_at 
      FROM leads_tracking 
      WHERE status = 'novo'
      AND first_response_at IS NULL
      AND created_at < NOW() - INTERVAL '2 hours'
      ${whereClause}
      ORDER BY created_at DESC
    `, params);

    // 2. Leads estagnados (sem interação há mais de 48h)
    const stagnant = await pool.query(`
      SELECT id, nome, telefone, last_interaction_at, status 
      FROM leads_tracking 
      WHERE status NOT IN ('venda_fechada', 'perdido', 'vendido')
      AND last_interaction_at < NOW() - INTERVAL '48 hours'
      ${whereClause}
      ORDER BY last_interaction_at DESC
    `, params);

    // 3. Leads quentes (Score > 70) sem follow-up há mais de 12h
    const hotLeads = await pool.query(`
      SELECT id, nome, telefone, lead_score, last_interaction_at 
      FROM leads_tracking 
      WHERE lead_score > 70
      AND status NOT IN ('venda_fechada', 'vendido')
      AND last_interaction_at < NOW() - INTERVAL '12 hours'
      ${whereClause}
      ORDER BY lead_score DESC
    `, params);

    res.status(200).json({
      summary: {
        slow_response_count: slowResponse.rows.length,
        stagnant_count: stagnant.rows.length,
        hot_leads_count: hotLeads.rows.length
      },
      details: {
        slow_response: slowResponse.rows,
        stagnant: stagnant.rows,
        hot_leads: hotLeads.rows
      }
    });

  } catch (error) {
    console.error('Alerts check error:', error);
    res.status(500).json({ error: 'Erro ao verificar alertas' });
  }
}
