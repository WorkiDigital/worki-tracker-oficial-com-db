import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { ensureTrackingSchema } from './_tracking-schema.js';

// CRUD de campanhas/links rastreáveis + seus destinos (rotador).
// Isolamento multi-tenant por cliente_id (admin pode passar cliente_id).
const ROTATION_MODES = new Set(['single', 'round_robin', 'weighted', 'priority']);
const ORIGIN_TYPES = new Set(['bio', 'campaign', 'rotator']);

const normalizarSlug = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

function normalizarDestinos(destinations) {
  if (!Array.isArray(destinations)) return null;
  const vistos = new Set();
  const instanciasVistas = new Set();
  const normalizados = destinations.map((d, position) => {
    const whatsapp_number = String(d.whatsapp_number || '').replace(/\D/g, '');
    const instance_name = String(d.instance_name || '').trim().slice(0, 100);
    if (whatsapp_number.length < 8 || whatsapp_number.length > 15) {
      throw new Error(`Número de WhatsApp inválido na posição ${position + 1}.`);
    }
    if (vistos.has(whatsapp_number)) {
      throw new Error(`Número de WhatsApp duplicado: ${whatsapp_number}.`);
    }
    if (!instance_name) {
      throw new Error(`Selecione a instância do destino na posição ${position + 1}.`);
    }
    if (instanciasVistas.has(instance_name)) {
      throw new Error(`Instância duplicada: ${instance_name}.`);
    }
    vistos.add(whatsapp_number);
    instanciasVistas.add(instance_name);
    return {
      id: Number.isInteger(Number(d.id)) ? Number(d.id) : null,
      name: String(d.name || '').trim().slice(0, 120) || null,
      whatsapp_number,
      instance_name,
      weight: Math.min(100, Math.max(1, parseInt(d.weight, 10) || 1)),
      position,
      enabled: d.enabled !== false,
    };
  });
  if (!normalizados.length) throw new Error('Adicione pelo menos um destino.');
  if (!normalizados.some(d => d.enabled)) throw new Error('Mantenha pelo menos um destino ativo.');
  return normalizados;
}

function validarDestinosPorModo(destinations, rotationMode) {
  if (rotationMode === 'single' && destinations.filter(d => d.enabled).length !== 1) {
    throw new Error('No modo destino único, mantenha exatamente um número ativo.');
  }
}

async function validarInstanciasDoCliente(client, clienteId, destinations) {
  const nomes = [...new Set(destinations.map(d => d.instance_name))];
  const prefix = `cliente_${clienteId}_`;
  const mapeadas = await client.query(
    `SELECT instance_name
     FROM instancias_mapeamento
     WHERE cliente_id=$1 AND instance_name = ANY($2::text[])`,
    [clienteId, nomes]
  );
  const permitidas = new Set(mapeadas.rows.map(r => r.instance_name));
  const invalidas = nomes.filter(nome => !permitidas.has(nome) && !nome.startsWith(prefix));
  if (invalidas.length) {
    throw new Error(`Instância não vinculada a este cliente: ${invalidas.join(', ')}.`);
  }
}

async function sincronizarDestinos(client, campaignId, clienteId, destinations) {
  const normalizados = normalizarDestinos(destinations);
  if (!normalizados) return;
  await validarInstanciasDoCliente(client, clienteId, normalizados);

  const existentes = await client.query(
    'SELECT id FROM tracking_destinations WHERE campaign_id=$1 AND cliente_id=$2 FOR UPDATE',
    [campaignId, clienteId]
  );
  const idsExistentes = new Set(existentes.rows.map(r => Number(r.id)));
  const idsMantidos = normalizados
    .map(d => d.id)
    .filter(id => id && idsExistentes.has(id));

  if (idsExistentes.size) {
    if (idsMantidos.length) {
      await client.query(
        'DELETE FROM tracking_destinations WHERE campaign_id=$1 AND cliente_id=$2 AND NOT (id = ANY($3::int[]))',
        [campaignId, clienteId, idsMantidos]
      );
    } else {
      await client.query(
        'DELETE FROM tracking_destinations WHERE campaign_id=$1 AND cliente_id=$2',
        [campaignId, clienteId]
      );
    }
  }

  for (const d of normalizados) {
    if (d.id && idsExistentes.has(d.id)) {
      await client.query(
        `UPDATE tracking_destinations
         SET name=$1, whatsapp_number=$2, instance_name=$3, weight=$4, position=$5, enabled=$6
         WHERE id=$7 AND campaign_id=$8 AND cliente_id=$9`,
        [d.name, d.whatsapp_number, d.instance_name, d.weight, d.position, d.enabled,
         d.id, campaignId, clienteId]
      );
    } else {
      await client.query(
        `INSERT INTO tracking_destinations
          (campaign_id, cliente_id, name, whatsapp_number, instance_name, weight, position, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [campaignId, clienteId, d.name, d.whatsapp_number, d.instance_name,
         d.weight, d.position, d.enabled]
      );
    }
  }
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  await ensureTrackingSchema();
  const pool = getPool();
  const alvoCliente = (val) => user.is_admin ? (val ? parseInt(val, 10) : user.cliente_id) : user.cliente_id;

  try {
    if (req.method === 'GET') {
      const cliente_id = alvoCliente(req.query.cliente_id);
      if (!cliente_id) return res.status(400).json({ error: 'cliente_id é obrigatório para administrador.' });
      // Detalhe de 1 campanha (com destinos) se vier id
      if (req.query.id) {
        const camp = await pool.query(
          'SELECT * FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2',
          [req.query.id, cliente_id]
        );
        if (!camp.rows.length) return res.status(404).json({ error: 'Campanha não encontrada.' });
        const dests = await pool.query(
          'SELECT * FROM tracking_destinations WHERE campaign_id=$1 AND cliente_id=$2 ORDER BY position, id',
          [req.query.id, cliente_id]
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
      if (!cliente_id) return res.status(400).json({ error: 'cliente_id é obrigatório para administrador.' });
      const { name, origin_type = 'bio', rotation_mode = 'single',
              default_message, utm_source, utm_medium, utm_campaign, utm_content, destinations = [] } = req.body;
      if (!name) return res.status(400).json({ error: 'name é obrigatório.' });
      if (!ORIGIN_TYPES.has(origin_type)) return res.status(400).json({ error: 'origin_type inválido.' });
      if (!ROTATION_MODES.has(rotation_mode)) return res.status(400).json({ error: 'rotation_mode inválido.' });

      let slug = normalizarSlug(req.body.slug || name);
      if (!slug) return res.status(400).json({ error: 'slug inválido.' });
      const destinosNormalizados = normalizarDestinos(destinations);
      validarDestinosPorModo(destinosNormalizados, rotation_mode);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const exists = await client.query('SELECT 1 FROM tracking_campaigns WHERE slug=$1', [slug]);
        if (exists.rows.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

        const camp = await client.query(
          `INSERT INTO tracking_campaigns
            (cliente_id, name, slug, origin_type, rotation_mode, default_message, utm_source, utm_medium, utm_campaign, utm_content)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [cliente_id, String(name).trim().slice(0, 255), slug, origin_type, rotation_mode,
           default_message || null, utm_source || null, utm_medium || null, utm_campaign || null, utm_content || null]
        );
        const campaign = camp.rows[0];
        await sincronizarDestinos(client, campaign.id, cliente_id, destinations);
        await client.query('COMMIT');
        return res.status(201).json(campaign);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (req.method === 'PATCH') {
      const cliente_id = alvoCliente(req.body.cliente_id);
      if (!cliente_id) return res.status(400).json({ error: 'cliente_id é obrigatório para administrador.' });
      const { id, destinations } = req.body;
      if (!id) return res.status(400).json({ error: 'id é obrigatório.' });

      if ('origin_type' in req.body && !ORIGIN_TYPES.has(req.body.origin_type)) {
        return res.status(400).json({ error: 'origin_type inválido.' });
      }
      if ('rotation_mode' in req.body && !ROTATION_MODES.has(req.body.rotation_mode)) {
        return res.status(400).json({ error: 'rotation_mode inválido.' });
      }
      if (Array.isArray(destinations)) normalizarDestinos(destinations);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const atual = await client.query(
          'SELECT * FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2 FOR UPDATE',
          [id, cliente_id]
        );
        if (!atual.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Campanha não encontrada.' });
        }
        const modoFinal = req.body.rotation_mode || atual.rows[0].rotation_mode || 'single';
        if (Array.isArray(destinations)) {
          validarDestinosPorModo(normalizarDestinos(destinations), modoFinal);
        } else if (modoFinal === 'single' && req.body.rotation_mode === 'single') {
          const ativos = await client.query(
            'SELECT COUNT(*)::int AS total FROM tracking_destinations WHERE campaign_id=$1 AND cliente_id=$2 AND enabled=true',
            [id, cliente_id]
          );
          if (ativos.rows[0].total !== 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No modo destino único, mantenha exatamente um número ativo.' });
          }
        }

        const bodyAtualizacao = { ...req.body };
        if ('slug' in bodyAtualizacao) {
          bodyAtualizacao.slug = normalizarSlug(bodyAtualizacao.slug);
          if (!bodyAtualizacao.slug) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'slug inválido.' });
          }
          const slugEmUso = await client.query(
            'SELECT 1 FROM tracking_campaigns WHERE slug=$1 AND id<>$2',
            [bodyAtualizacao.slug, id]
          );
          if (slugEmUso.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Este identificador de URL já está em uso.' });
          }
        }

        const campos = ['name','slug','origin_type','rotation_mode','default_message','utm_source','utm_medium','utm_campaign','utm_content','enabled'];
        const sets = [], vals = []; let i = 1;
        for (const campo of campos) {
          if (campo in bodyAtualizacao) {
            sets.push(`${campo}=$${i++}`);
            vals.push(campo === 'name' ? String(bodyAtualizacao[campo] || '').trim().slice(0, 255) : bodyAtualizacao[campo]);
          }
        }
        if (sets.length) {
          sets.push('updated_at=NOW()');
          vals.push(id, cliente_id);
          await client.query(
            `UPDATE tracking_campaigns SET ${sets.join(', ')} WHERE id=$${i++} AND cliente_id=$${i}`,
            vals
          );
        }

        if (Array.isArray(destinations)) {
          await sincronizarDestinos(client, Number(id), cliente_id, destinations);
        }

        const out = await client.query(
          'SELECT * FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2',
          [id, cliente_id]
        );
        await client.query('COMMIT');
        return res.status(200).json(out.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (req.method === 'DELETE') {
      const cliente_id = alvoCliente(req.query.cliente_id || req.body?.cliente_id);
      if (!cliente_id) return res.status(400).json({ error: 'cliente_id é obrigatório para administrador.' });
      const id = req.query.id || req.body?.id;
      if (!id) return res.status(400).json({ error: 'id é obrigatório.' });

      // O trigger do banco impede apagar clique 'converted' (preserva atribuição).
      // Para deletar a campanha sem violar isso, primeiro desvinculamos os leads
      // dos cliques desta campanha (zerando a origem órfã), depois marcamos os
      // cliques convertidos como históricos (não-converted), e só então o
      // ON DELETE CASCADE pode removê-los. Tudo transacional.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const dono = await client.query(
          'SELECT id FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2 FOR UPDATE',
          [id, cliente_id]
        );
        if (!dono.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Não encontrado ou acesso negado.' });
        }
        // Desvincula os leads dos cliques desta campanha e normaliza a origem.
        await client.query(
          `UPDATE leads_tracking
           SET tracking_click_id=NULL, tracking_campaign_id=NULL, tracking_method=NULL,
               lead_origin = CASE WHEN lead_origin IN ('bio','rotator','campaign_link')
                                  THEN 'organic' ELSE lead_origin END
           WHERE tracking_campaign_id=$1`,
          [id]
        );
        // Libera os cliques convertidos do bloqueio do trigger (vira histórico).
        await client.query(
          `UPDATE tracking_clicks SET status='archived', lead_id=NULL
           WHERE campaign_id=$1 AND status='converted'`,
          [id]
        );
        const r = await client.query(
          'DELETE FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2 RETURNING id',
          [id, cliente_id]
        );
        await client.query('COMMIT');
        return res.status(200).json({ deleted: r.rows[0].id });
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw e;
      } finally {
        client.release();
      }
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('[tracking-campaigns]', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Este identificador de URL já está em uso.' });
    }
    if (/inválid|duplicado|adicione|mantenha|destino único|instância|vinculada|posição/i.test(err.message || '')) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Erro interno ao salvar o link rastreável.' });
  }
}
