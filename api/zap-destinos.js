import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';

let _zapDestinosSchemaEnsured = false;
async function ensureZapDestinosSchema(pool) {
  if (_zapDestinosSchemaEnsured) return;
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
    ADD COLUMN IF NOT EXISTS destino_id INTEGER REFERENCES public.zap_destinos(id) ON DELETE CASCADE;
    ALTER TABLE public.zap_agendamentos
    ALTER COLUMN instance_name DROP NOT NULL,
    ALTER COLUMN destino_jid DROP NOT NULL;
  `);
  _zapDestinosSchemaEnsured = true;
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  await ensureZapDestinosSchema(pool);
  const clienteId = user.cliente_id ?? null;

  const tenantWhere  = clienteId !== null ? 'WHERE cliente_id = $1' : '';
  const tenantAnd    = clienteId !== null ? 'AND cliente_id = $2'    : '';
  const tenantParams = clienteId !== null ? [clienteId]              : [];

  try {
    if (req.method === 'GET') {
      if (req.query.id) {
        const dest = await pool.query(
          `SELECT * FROM zap_destinos WHERE id=$1 ${clienteId !== null ? 'AND cliente_id=$2' : ''}`,
          clienteId !== null ? [req.query.id, clienteId] : [req.query.id]
        );
        if (!dest.rows.length) return res.status(404).json({ error: 'Destino não encontrado.' });
        const relatorios = await pool.query(
          `SELECT id, destino_id, template, frequencia, to_char(horario,'HH24:MI') AS horario,
                  COALESCE(periodo, 'yesterday') AS periodo,
                  campaign_filter_text,
                  COALESCE(campaign_objectives, '{}'::text[]) AS campaign_objectives,
                  status, criado_em
           FROM zap_agendamentos
           WHERE destino_id=$1
           ORDER BY criado_em DESC`,
          [req.query.id]
        );
        return res.status(200).json({ ...dest.rows[0], relatorios: relatorios.rows });
      }

      const result = await pool.query(
        `SELECT zd.*,
           (SELECT COUNT(*) FROM zap_agendamentos za WHERE za.destino_id = zd.id) AS total_relatorios
         FROM zap_destinos zd
         ${tenantWhere}
         ORDER BY criado_em DESC`,
        tenantParams
      );
      return res.status(200).json(result.rows);
    }

    if (req.method === 'POST') {
      const { nome, account_id, instance_name, destino_tipo, destino_jid, destino_nome } = req.body || {};
      if (!nome || !instance_name || !destino_jid) {
        return res.status(400).json({ error: 'nome, instance_name e destino_jid sao obrigatorios' });
      }
      const result = await pool.query(
        `INSERT INTO zap_destinos
           (cliente_id, nome, account_id, instance_name, destino_tipo, destino_jid, destino_nome)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [clienteId, nome, account_id || null, instance_name, destino_tipo || 'grupo', destino_jid, destino_nome || '']
      );
      return res.status(201).json({ id: result.rows[0].id });
    }

    if (req.method === 'PUT') {
      const { id, nome, account_id, instance_name, destino_tipo, destino_jid, destino_nome } = req.body || {};
      if (!id || !nome || !instance_name || !destino_jid) {
        return res.status(400).json({ error: 'id, nome, instance_name e destino_jid sao obrigatorios' });
      }
      const params = [nome, account_id || null, instance_name, destino_tipo || 'grupo', destino_jid, destino_nome || '', id];
      const tenantClause = clienteId !== null ? ` AND cliente_id = $${params.length + 1}` : '';
      if (clienteId !== null) params.push(clienteId);
      const result = await pool.query(
        `UPDATE zap_destinos
         SET nome=$1, account_id=$2, instance_name=$3, destino_tipo=$4, destino_jid=$5, destino_nome=$6
         WHERE id=$7${tenantClause}
         RETURNING id`,
        params
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Destino não encontrado.' });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id;
      if (!id) return res.status(400).json({ error: 'id obrigatorio' });
      const result = await pool.query(
        `DELETE FROM zap_destinos WHERE id = $1 ${tenantAnd} RETURNING id`,
        [id, ...tenantParams]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Destino não encontrado.' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Metodo nao permitido' });
  } catch (err) {
    console.error('[zap-destinos]', err);
    return res.status(500).json({ error: err.message });
  }
}
