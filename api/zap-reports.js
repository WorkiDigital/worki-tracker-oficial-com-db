import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const clienteId = user.cliente_id ?? null;

  // Cláusula de isolamento: admin sem cliente_id vê tudo; cliente vê só os seus
  const tenantWhere  = clienteId !== null ? 'WHERE cliente_id = $1'       : '';
  const tenantAnd    = clienteId !== null ? 'AND cliente_id = $2'          : '';
  const tenantParams = clienteId !== null ? [clienteId]                    : [];

  try {
    // LIST
    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT id, instance_name, destino_tipo, destino_jid, destino_nome,
                template, frequencia, to_char(horario,'HH24:MI') AS horario,
                status, criado_em
         FROM zap_agendamentos
         ${tenantWhere}
         ORDER BY criado_em DESC`,
        tenantParams
      );
      return res.status(200).json(result.rows);
    }

    // CREATE
    if (req.method === 'POST') {
      const { instance_name, destino_tipo, destino_jid, destino_nome, template, frequencia, horario } = req.body || {};
      if (!instance_name || !destino_jid || !horario) {
        return res.status(400).json({ error: 'instance_name, destino_jid e horario são obrigatórios' });
      }
      const result = await pool.query(
        `INSERT INTO zap_agendamentos
           (cliente_id, instance_name, destino_tipo, destino_jid, destino_nome, template, frequencia, horario)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [clienteId, instance_name, destino_tipo || 'grupo', destino_jid, destino_nome || '', template || '', frequencia || 'diario', horario]
      );
      return res.status(201).json({ id: result.rows[0].id });
    }

    // TOGGLE STATUS
    if (req.method === 'PATCH') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      const result = await pool.query(
        `UPDATE zap_agendamentos
         SET status = CASE WHEN status = 'ativo' THEN 'pausado' ELSE 'ativo' END
         WHERE id = $1 ${tenantAnd}
         RETURNING status`,
        [id, ...tenantParams]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Agendamento não encontrado' });
      return res.status(200).json({ status: result.rows[0].status });
    }

    // DELETE
    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id;
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      const result = await pool.query(
        `DELETE FROM zap_agendamentos WHERE id = $1 ${tenantAnd} RETURNING id`,
        [id, ...tenantParams]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Agendamento não encontrado' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('[zap-reports]', err);
    return res.status(500).json({ error: err.message });
  }
}
