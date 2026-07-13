import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { normalizeCampaignFilters } from './_zap-report-metrics.js';

let _zapFilterColumnsEnsured = false;
async function ensureZapFilterColumns(pool) {
  if (_zapFilterColumnsEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.zap_destinos (
      id            SERIAL PRIMARY KEY,
      cliente_id    INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
      nome          VARCHAR(255) NOT NULL,
      account_id    VARCHAR(255),
      instance_name VARCHAR(255) NOT NULL,
      destino_tipo  VARCHAR(20)  DEFAULT 'grupo',
      destino_jid   VARCHAR(255) NOT NULL,
      destino_nome  VARCHAR(255),
      criado_em     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE public.zap_agendamentos
    ADD COLUMN IF NOT EXISTS campaign_filter_text TEXT,
    ADD COLUMN IF NOT EXISTS campaign_objectives TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS destino_id INTEGER REFERENCES public.zap_destinos(id) ON DELETE CASCADE;
    ALTER TABLE public.zap_agendamentos
    ALTER COLUMN instance_name DROP NOT NULL,
    ALTER COLUMN destino_jid DROP NOT NULL;
  `);
  _zapFilterColumnsEnsured = true;
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (process.env.NODE_ENV !== 'production' && req.method === 'GET') {
    return res.status(200).json([
      { id: 9101, destino_id: Number(req.query.destino_id || 9001), template: 'Relatorio diario modelo: leads, conversas, vendas e faturamento.', frequencia: 'diario', horario: '09:00', periodo: 'yesterday', campaign_filter_text: 'DEMO', campaign_objectives: ['OUTCOME_LEADS'], status: 'ativo', criado_em: new Date().toISOString() },
      { id: 9102, destino_id: Number(req.query.destino_id || 9001), template: 'Resumo semanal modelo por campanha e objetivo.', frequencia: 'semanal', horario: '18:30', periodo: 'last_7d', campaign_filter_text: 'DEMO', campaign_objectives: ['OUTCOME_SALES','OUTCOME_LEADS'], status: 'ativo', criado_em: new Date().toISOString() }
    ]);
  }

  const pool = getPool();
  await ensureZapFilterColumns(pool);
  const clienteId = user.cliente_id ?? null;

  const tenantWhere  = clienteId !== null ? 'WHERE cliente_id = $1'       : '';
  const tenantAnd    = clienteId !== null ? 'AND cliente_id = $2'          : '';
  const tenantParams = clienteId !== null ? [clienteId]                    : [];

  try {
    if (req.method === 'GET') {
      const conds = [];
      const params = [];
      if (clienteId !== null) { params.push(clienteId); conds.push(`cliente_id = $${params.length}`); }
      if (req.query.destino_id) { params.push(req.query.destino_id); conds.push(`destino_id = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const result = await pool.query(
        `SELECT id, destino_id, template, frequencia, to_char(horario,'HH24:MI') AS horario,
                COALESCE(periodo, 'yesterday') AS periodo,
                campaign_filter_text,
                COALESCE(campaign_objectives, '{}'::text[]) AS campaign_objectives,
                status, criado_em
         FROM zap_agendamentos
         ${where}
         ORDER BY criado_em DESC`,
        params
      );
      return res.status(200).json(result.rows);
    }

    if (req.method === 'POST') {
      const { destino_id, template, frequencia, horario, periodo } = req.body || {};
      if (!destino_id || !horario) {
        return res.status(400).json({ error: 'destino_id e horario sao obrigatorios' });
      }
      const filters = normalizeCampaignFilters(req.body || {});
      const result = await pool.query(
        `INSERT INTO zap_agendamentos
           (cliente_id, destino_id, template, frequencia, horario, periodo, campaign_filter_text, campaign_objectives)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [clienteId, destino_id, template || '', frequencia || 'diario', horario, periodo || 'yesterday', filters.text || null, filters.objectives]
      );
      return res.status(201).json({ id: result.rows[0].id });
    }

    if (req.method === 'PUT') {
      const { id, template, frequencia, horario, periodo } = req.body || {};
      if (!id || !horario) {
        return res.status(400).json({ error: 'id e horario sao obrigatorios' });
      }
      const filters = normalizeCampaignFilters(req.body || {});
      const params = [
        template || '', frequencia || 'diario', horario, periodo || 'yesterday',
        filters.text || null, filters.objectives, id,
      ];
      const tenantClause = clienteId !== null ? ` AND cliente_id = $${params.length + 1}` : '';
      if (clienteId !== null) params.push(clienteId);
      const result = await pool.query(
        `UPDATE zap_agendamentos
         SET template=$1, frequencia=$2, horario=$3, periodo=$4,
             campaign_filter_text=$5, campaign_objectives=$6
         WHERE id=$7${tenantClause}
         RETURNING id`,
        params
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Relatório não encontrado' });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obrigatorio' });
      const result = await pool.query(
        `UPDATE zap_agendamentos
         SET status = CASE WHEN status = 'ativo' THEN 'pausado' ELSE 'ativo' END
         WHERE id = $1 ${tenantAnd}
         RETURNING status`,
        [id, ...tenantParams]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Relatório não encontrado' });
      return res.status(200).json({ status: result.rows[0].status });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id;
      if (!id) return res.status(400).json({ error: 'id obrigatorio' });
      const result = await pool.query(
        `DELETE FROM zap_agendamentos WHERE id = $1 ${tenantAnd} RETURNING id`,
        [id, ...tenantParams]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Relatório não encontrado' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Metodo nao permitido' });
  } catch (err) {
    console.error('[zap-reports]', err);
    return res.status(500).json({ error: err.message });
  }
}
