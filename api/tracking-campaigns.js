import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';

// CRUD de campanhas/links rastreáveis + seus destinos (rotador).
// Isolamento multi-tenant por cliente_id (admin pode passar cliente_id).
export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const alvoCliente = (val) => user.is_admin ? (val ? parseInt(val, 10) : user.cliente_id) : user.cliente_id;

  // slug: minúsculas, sem acento, hífens
  const normalizarSlug = (s) => (s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

  try {
    if (req.method === 'GET') {
      const cliente_id = alvoCliente(req.query.cliente_id);
      // Detalhe de 1 campanha (com destinos) se vier id
      if (req.query.id) {
        const camp = await pool.query(
          'SELECT * FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2',
          [req.query.id, cliente_id]
        );
        if (!camp.rows.length) return res.status(404).json({ error: 'Campanha não encontrada.' });
        const dests = await pool.query(
          'SELECT * FROM tracking_destinations WHERE campaign_id=$1 ORDER BY position, id',
          [req.query.id]
        );
        return res.status(200).json({ ...camp.rows[0], destinations: dests.rows });
      }
      // Lista com contagem de cliques/conversões
      const r = await pool.query(
        `SELECT c.*,
           (SELECT COUNT(*) FROM tracking_clicks k WHERE k.campaign_id=c.id) AS cliques,
           (SELECT COUNT(*) FROM tracking_clicks k WHERE k.campaign_id=c.id AND k.status='converted') AS conversoes
         FROM tracking_campaigns c
         WHERE c.cliente_id=$1 ORDER BY c.created_at DESC`,
        [cliente_id]
      );
      return res.status(200).json(r.rows);
    }

    if (req.method === 'POST') {
      const cliente_id = alvoCliente(req.body.cliente_id);
      const { name, origin_type = 'bio', rotation_mode = 'single',
              default_message, utm_source, utm_medium, utm_campaign, destinations = [] } = req.body;
      if (!name) return res.status(400).json({ error: 'name é obrigatório.' });

      let slug = normalizarSlug(req.body.slug || name);
      if (!slug) return res.status(400).json({ error: 'slug inválido.' });
      // Garante unicidade do slug
      const exists = await pool.query('SELECT 1 FROM tracking_campaigns WHERE slug=$1', [slug]);
      if (exists.rows.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

      const camp = await pool.query(
        `INSERT INTO tracking_campaigns
          (cliente_id, name, slug, origin_type, rotation_mode, default_message, utm_source, utm_medium, utm_campaign)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [cliente_id, name, slug, origin_type, rotation_mode, default_message || null,
         utm_source || null, utm_medium || null, utm_campaign || null]
      );
      const campaign = camp.rows[0];

      // Destinos (opcional no create)
      for (let i = 0; i < destinations.length; i++) {
        const d = destinations[i];
        if (!d.whatsapp_number) continue;
        await pool.query(
          `INSERT INTO tracking_destinations
            (campaign_id, cliente_id, name, whatsapp_number, instance_name, weight, position, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [campaign.id, cliente_id, d.name || null, String(d.whatsapp_number).replace(/\D/g, ''),
           d.instance_name || null, parseInt(d.weight, 10) || 1, i, d.enabled !== false]
        );
      }
      return res.status(201).json(campaign);
    }

    if (req.method === 'PATCH') {
      const cliente_id = alvoCliente(req.body.cliente_id);
      const { id, destinations } = req.body;
      if (!id) return res.status(400).json({ error: 'id é obrigatório.' });

      // Atualiza campos da campanha (apenas os enviados)
      const campos = ['name','origin_type','rotation_mode','default_message','utm_source','utm_medium','utm_campaign','enabled'];
      const sets = [], vals = []; let i = 1;
      for (const c of campos) {
        if (c in req.body) { sets.push(`${c}=$${i++}`); vals.push(req.body[c]); }
      }
      if (sets.length) {
        sets.push(`updated_at=NOW()`);
        vals.push(id, cliente_id);
        await pool.query(
          `UPDATE tracking_campaigns SET ${sets.join(', ')} WHERE id=$${i++} AND cliente_id=$${i}`,
          vals
        );
      }

      // Substitui destinos se vierem (replace completo — mais simples no painel)
      if (Array.isArray(destinations)) {
        await pool.query('DELETE FROM tracking_destinations WHERE campaign_id=$1 AND cliente_id=$2', [id, cliente_id]);
        for (let j = 0; j < destinations.length; j++) {
          const d = destinations[j];
          if (!d.whatsapp_number) continue;
          await pool.query(
            `INSERT INTO tracking_destinations
              (campaign_id, cliente_id, name, whatsapp_number, instance_name, weight, position, enabled)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, cliente_id, d.name || null, String(d.whatsapp_number).replace(/\D/g, ''),
             d.instance_name || null, parseInt(d.weight, 10) || 1, j, d.enabled !== false]
          );
        }
      }
      const out = await pool.query('SELECT * FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2', [id, cliente_id]);
      return res.status(200).json(out.rows[0] || null);
    }

    if (req.method === 'DELETE') {
      const cliente_id = alvoCliente(req.query.cliente_id || req.body?.cliente_id);
      const id = req.query.id || req.body?.id;
      if (!id) return res.status(400).json({ error: 'id é obrigatório.' });
      const r = await pool.query(
        'DELETE FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2 RETURNING id',
        [id, cliente_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Não encontrado ou acesso negado.' });
      return res.status(200).json({ deleted: r.rows[0].id });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('[tracking-campaigns]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
