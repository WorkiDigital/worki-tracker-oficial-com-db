import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { normalizeCampaignFilters } from './_zap-report-metrics.js';

let _zapFilterColumnsEnsured = false;
async function ensureZapFilterColumns(pool) {
  if (_zapFilterColumnsEnsured) return;
  await pool.query(`
    ALTER TABLE public.zap_agendamentos
    ADD COLUMN IF NOT EXISTS campaign_filter_text TEXT,
    ADD COLUMN IF NOT EXISTS campaign_objectives TEXT[] DEFAULT '{}'
  `);
  _zapFilterColumnsEnsured = true;
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  await ensureZapFilterColumns(pool);
  const clienteId = user.cliente_id ?? null;

  const tenantWhere  = clienteId !== null ? 'WHERE cliente_id = $1'       : '';
  const tenantAnd    = clienteId !== null ? 'AND cliente_id = $2'          : '';
  const tenantParams = clienteId !== null ? [clienteId]                    : [];

  try {
    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT id, instance_name, destino_tipo, destino_jid, destino_nome,
                template, frequencia, to_char(horario,'HH24:MI') AS horario,
                COALESCE(periodo, 'yesterday') AS periodo,
                account_id, campaign_filter_text,
                COALESCE(campaign_objectives, '{}'::text[]) AS campaign_objectives,
                status, criado_em
         FROM zap_agendamentos
         ${tenantWhere}
         ORDER BY criado_em DESC`,
        tenantParams
      );
      return res.status(200).json(result.rows);
    }

    if (req.method === 'POST') {
      const { instance_name, destino_tipo, destino_jid, destino_nome, template, frequencia, horario, periodo, account_id } = req.body || {};
      if (!instance_name || !destino_jid || !horario) {
        return res.status(400).json({ error: 'instance_name, destino_jid e horario sao obrigatorios' });
      }
      const filters = normalizeCampaignFilters(req.body || {});
      const result = await pool.query(
        `INSERT INTO zap_agendamentos
           (cliente_id, instance_name, destino_tipo, destino_jid, destino_nome, template, frequencia, horario, periodo, account_id, campaign_filter_text, campaign_objectives)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [clienteId, instance_name, destino_tipo || 'grupo', destino_jid, destino_nome || '', template || '', frequencia || 'diario', horario, periodo || 'yesterday', account_id || null, filters.text || null, filters.objectives]
      );
      return res.status(201).json({ id: result.rows[0].id });
    }

    if (req.method === 'PUT') {
      const { id, instance_name, destino_tipo, destino_jid, destino_nome, template, frequencia, horario, periodo, account_id } = req.body || {};
      if (!id || !instance_name || !destino_jid || !horario) {
        return res.status(400).json({ error: 'id, instance_name, destino_jid e horario sao obrigatorios' });
      }
      const filters = normalizeCampaignFilters(req.body || {});
      const params = [
        instance_name, destino_tipo || 'grupo', destino_jid, destino_nome || '', template || '',
        frequencia || 'diario', horario, periodo || 'yesterday', account_id || null,
        filters.text || null, filters.objectives, id,
      ];
      const tenantClause = clienteId !== null ? ` AND cliente_id = $${params.length + 1}` : '';
      if (clienteId !== null) params.push(clienteId);
      const result = await pool.query(
        `UPDATE zap_agendamentos
         SET instance_name=$1, destino_tipo=$2, destino_jid=$3, destino_nome=$4,
             template=$5, frequencia=$6, horario=$7, periodo=$8, account_id=$9,
             campaign_filter_text=$10, campaign_objectives=$11
         WHERE id=$12${tenantClause}
         RETURNING id`,
        params
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Agendamento nao encontrado' });
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
      if (result.rowCount === 0) return res.status(404).json({ error: 'Agendamento nao encontrado' });
      return res.status(200).json({ status: result.rows[0].status });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id;
      if (!id) return res.status(400).json({ error: 'id obrigatorio' });
      const result = await pool.query(
        `DELETE FROM zap_agendamentos WHERE id = $1 ${tenantAnd} RETURNING id`,
        [id, ...tenantParams]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Agendamento nao encontrado' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Metodo nao permitido' });
  } catch (err) {
    console.error('[zap-reports]', err);
    return res.status(500).json({ error: err.message });
  }
}