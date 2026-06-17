import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  try {
    const pool = getPool();

    // Busca o lead principal com todas as colunas relevantes
    const leadRes = await pool.query(`
      SELECT
        id, nome, telefone, status, plataforma, instancia,
        created_at, event_time, first_response_at, sale_closed_at, qualified_at,
        utm_campaign, utm_medium, utm_content, source_id,
        mensagem_recebida, valor_venda, lead_score,
        email, cpf, endereco, cidade, estado, produto,
        ctw_aci_id, cliente_id, page_id
      FROM leads_tracking
      WHERE id = $1
    `, [id]);

    if (!leadRes.rows.length) return res.status(404).json({ error: 'Lead não encontrado' });
    const lead = leadRes.rows[0];

    // Segurança: não-admin só acessa leads do próprio cliente
    if (!user.is_admin && lead.cliente_id !== user.cliente_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Busca todos os contatos do mesmo telefone no mesmo cliente — a jornada completa
    const jornadaRes = await pool.query(`
      SELECT
        id, created_at, status, utm_campaign, utm_medium, utm_content,
        source_id, plataforma, instancia, mensagem_recebida,
        first_response_at, sale_closed_at, valor_venda, produto, ctw_aci_id
      FROM leads_tracking
      WHERE telefone = $1 AND cliente_id = $2
      ORDER BY created_at ASC
    `, [lead.telefone, lead.cliente_id]);

    return res.status(200).json({
      lead,
      jornada: jornadaRes.rows,
    });

  } catch (err) {
    console.error('[lead-profile]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
