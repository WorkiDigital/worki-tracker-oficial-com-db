import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';

// Config de captura de leads por instância (ctwa_only | all | keyword).
// Padrão multi-tenant: usuário comum só mexe nas configs do próprio cliente_id;
// admin pode operar sobre qualquer cliente passando cliente_id no body/query.
export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PATCH', 'PUT'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const method = req.method;

  // Resolve o cliente alvo respeitando o isolamento.
  const alvoCliente = (val) => {
    if (user.is_admin) return val ? parseInt(val, 10) : user.cliente_id;
    return user.cliente_id;
  };

  try {
    if (method === 'GET') {
      const cliente_id = alvoCliente(req.query.cliente_id);
      const { instance_name } = req.query;
      if (instance_name) {
        const r = await pool.query(
          'SELECT * FROM lead_capture_settings WHERE cliente_id = $1 AND instance_name = $2',
          [cliente_id, instance_name]
        );
        return res.status(200).json(r.rows[0] || null);
      }
      const r = await pool.query(
        'SELECT * FROM lead_capture_settings WHERE cliente_id = $1 ORDER BY instance_name',
        [cliente_id]
      );
      return res.status(200).json(r.rows);
    }

    // Upsert (POST/PATCH/PUT tratados igual — cria ou atualiza a config da instância)
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      const cliente_id = alvoCliente(req.body.cliente_id);
      const {
        instance_name,
        capture_mode = 'ctwa_only',
        keywords = [],
        keyword_match = 'partial',
        deduplication_hours = 24,
        enabled = true,
      } = req.body;

      if (!instance_name) {
        return res.status(400).json({ error: 'instance_name é obrigatório.' });
      }
      const MODOS = ['ctwa_only', 'all', 'keyword'];
      if (!MODOS.includes(capture_mode)) {
        return res.status(400).json({ error: `capture_mode inválido. Use: ${MODOS.join(', ')}` });
      }
      const kwArray = Array.isArray(keywords)
        ? keywords.map(k => String(k).trim()).filter(Boolean)
        : String(keywords).split(',').map(k => k.trim()).filter(Boolean);

      const r = await pool.query(
        `INSERT INTO lead_capture_settings
           (cliente_id, instance_name, capture_mode, keywords, keyword_match, deduplication_hours, enabled, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (cliente_id, instance_name) DO UPDATE SET
           capture_mode        = EXCLUDED.capture_mode,
           keywords            = EXCLUDED.keywords,
           keyword_match       = EXCLUDED.keyword_match,
           deduplication_hours = EXCLUDED.deduplication_hours,
           enabled             = EXCLUDED.enabled,
           updated_at          = NOW()
         RETURNING *`,
        [cliente_id, instance_name, capture_mode, kwArray,
         keyword_match === 'exact' ? 'exact' : 'partial',
         parseInt(deduplication_hours, 10) || 24, enabled !== false]
      );
      return res.status(200).json(r.rows[0]);
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('[lead-capture-settings]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
