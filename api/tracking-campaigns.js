import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { CONCEPTS } from './_capi.js';
import { randomUUID } from 'crypto';

// CRUD de campanhas/links rastreáveis + seus destinos (rotador).
// Isolamento multi-tenant por cliente_id (admin pode passar cliente_id).
const ROTATION_MODES = new Set(['single', 'round_robin', 'weighted', 'priority']);
const ORIGIN_TYPES = new Set(['bio', 'campaign', 'rotator']);
const WEB_CONCEPTS = new Set(CONCEPTS.filter(c => c.web).map(c => c.key));
const KEYWORD_MATCHES = new Set(['partial', 'exact']);

function getInstanceName(i) {
  return i?.instance?.instanceName || i?.instanceName || i?.name || '';
}

function getInstancePhone(i) {
  const raw = i?.instance?.ownerJid || i?.ownerJid
    || i?.instance?.number || i?.number
    || i?.instance?.wuid || i?.wuid || '';
  const digits = String(raw).split('@')[0].replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

async function carregarInstanciasEvolution() {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_GLOBAL_KEY;
  if (!url || !key) {
    throw new Error('Instância não pôde ser validada: configuração da Evolution API ausente.');
  }
  const response = await fetch(`${url}/instance/fetchInstances`, {
    headers: { apikey: key, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Instância não pôde ser validada na Evolution API (HTTP ${response.status}).`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function normalizarDestinos(destinations) {
  if (!Array.isArray(destinations)) return null;
  const instanciasVistas = new Set();
  const normalizados = destinations.map((d, position) => {
    const whatsapp_number = String(d.whatsapp_number || '').replace(/\D/g, '');
    const instance_name = String(d.instance_name || '').trim().slice(0, 100);
    if (!instance_name) {
      throw new Error(`Selecione a instância do destino na posição ${position + 1}.`);
    }
    if (instanciasVistas.has(instance_name)) {
      throw new Error(`Instância duplicada: ${instance_name}.`);
    }
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
  const mapeadas = await client.query(
    `SELECT instance_name
     FROM instancias_mapeamento
     WHERE cliente_id=$1 AND instance_name = ANY($2::text[])`,
    [clienteId, nomes]
  );
  const permitidas = new Set(mapeadas.rows.map(r => r.instance_name));
  const invalidas = nomes.filter(nome => !permitidas.has(nome));
  if (invalidas.length) {
    throw new Error(`Instância não vinculada a este cliente: ${invalidas.join(', ')}.`);
  }

  // O número enviado pelo navegador não é confiável. A Evolution é a fonte
  // autoritativa e o backend substitui o valor pelo número real da instância.
  const instances = await carregarInstanciasEvolution();
  const liveMap = new Map(instances.map(i => [getInstanceName(i), getInstancePhone(i)]));
  for (const destino of destinations) {
    if (!liveMap.has(destino.instance_name)) {
      throw new Error(`Instância não encontrada na Evolution API: ${destino.instance_name}.`);
    }
    const phone = liveMap.get(destino.instance_name);
    if (!phone) {
      throw new Error(`Instância sem número de WhatsApp conectado: ${destino.instance_name}.`);
    }
    destino.whatsapp_number = phone;
  }

  const numeros = new Set();
  for (const destino of destinations) {
    if (numeros.has(destino.whatsapp_number)) {
      throw new Error(`Número de WhatsApp duplicado entre as instâncias: ${destino.whatsapp_number}.`);
    }
    numeros.add(destino.whatsapp_number);
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

function normalizarEtapasJornada(stages) {
  if (!Array.isArray(stages)) return null;
  return stages.map((stage, position) => {
    const stageId = Number(stage.id);
    const name = String(stage.name || '').trim().slice(0, 120);
    const eventConcept = String(stage.event_concept || '').trim();
    const keywords = (Array.isArray(stage.keywords) ? stage.keywords : String(stage.keywords || '').split(','))
      .map(k => String(k).trim())
      .filter(Boolean);
    const valueRegex = String(stage.value_regex || '').trim() || null;

    if (!name) throw new Error(`Informe o nome da etapa ${position + 1}.`);
    if (!WEB_CONCEPTS.has(eventConcept)) {
      throw new Error(`Evento Meta inválido na etapa "${name}".`);
    }
    if (!keywords.length) {
      throw new Error(`Informe ao menos uma palavra-chave na etapa "${name}".`);
    }
    if (valueRegex) {
      try { new RegExp(valueRegex); } catch {
        throw new Error(`Regex de valor inválida na etapa "${name}".`);
      }
    }

    return {
      id: Number.isInteger(stageId) && stageId > 0 ? stageId : null,
      name,
      event_concept: eventConcept,
      trigger_type: 'keyword',
      keywords,
      keyword_match: KEYWORD_MATCHES.has(stage.keyword_match) ? stage.keyword_match : 'partial',
      value_regex: valueRegex,
      currency: String(stage.currency || 'BRL').trim().slice(0, 8) || 'BRL',
      position,
      enabled: stage.enabled !== false,
    };
  });
}

async function sincronizarEtapasJornada(client, campaignId, clienteId, stages) {
  const normalizadas = normalizarEtapasJornada(stages);
  if (!normalizadas) return;

  const existentes = await client.query(
    `SELECT id
     FROM journey_stages
     WHERE tracking_campaign_id=$1 AND cliente_id=$2
     FOR UPDATE`,
    [campaignId, clienteId]
  );
  const idsExistentes = new Set(existentes.rows.map(row => Number(row.id)));

  for (const stage of normalizadas) {
    if (stage.id && !idsExistentes.has(stage.id)) {
      throw new Error(`Etapa de jornada inválida para este link: ${stage.id}.`);
    }
  }

  const idsMantidos = normalizadas.map(stage => stage.id).filter(Boolean);
  if (idsExistentes.size) {
    if (idsMantidos.length) {
      await client.query(
        `DELETE FROM journey_stages
         WHERE tracking_campaign_id=$1 AND cliente_id=$2
           AND NOT (id = ANY($3::int[]))`,
        [campaignId, clienteId, idsMantidos]
      );
    } else {
      await client.query(
        'DELETE FROM journey_stages WHERE tracking_campaign_id=$1 AND cliente_id=$2',
        [campaignId, clienteId]
      );
    }
  }

  for (const stage of normalizadas) {
    const values = [
      stage.name, stage.event_concept, stage.trigger_type, stage.keywords,
      stage.keyword_match, stage.value_regex, stage.currency, stage.position,
      stage.enabled,
    ];
    if (stage.id) {
      await client.query(
        `UPDATE journey_stages SET
           name=$1, event_concept=$2, trigger_type=$3, keywords=$4,
           keyword_match=$5, value_regex=$6, currency=$7, position=$8,
           enabled=$9, updated_at=NOW()
         WHERE id=$10 AND tracking_campaign_id=$11 AND cliente_id=$12`,
        [...values, stage.id, campaignId, clienteId]
      );
    } else {
      await client.query(
        `INSERT INTO journey_stages
          (cliente_id, tracking_campaign_id, name, event_concept, trigger_type,
           keywords, keyword_match, value_regex, currency, position, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [clienteId, campaignId, ...values]
      );
    }
  }
}

function validarEventoConversao(evento) {
  if (!WEB_CONCEPTS.has(String(evento || 'lead'))) {
    throw new Error('Evento de conversão inválido para links rastreáveis.');
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
          'SELECT * FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2 AND archived_at IS NULL',
          [req.query.id, cliente_id]
        );
        if (!camp.rows.length) return res.status(404).json({ error: 'Campanha não encontrada.' });
        const dests = await pool.query(
          'SELECT * FROM tracking_destinations WHERE campaign_id=$1 AND cliente_id=$2 ORDER BY position, id',
          [req.query.id, cliente_id]
        );
        const stages = await pool.query(
          `SELECT * FROM journey_stages
           WHERE tracking_campaign_id=$1 AND cliente_id=$2
           ORDER BY position, id`,
          [req.query.id, cliente_id]
        );
        return res.status(200).json({
          ...camp.rows[0],
          destinations: dests.rows,
          journey_stages: stages.rows,
        });
      }
      // Lista com contagem de cliques/conversões
      const r = await pool.query(
        `SELECT c.*,
           (SELECT COUNT(*) FROM tracking_clicks k WHERE k.campaign_id=c.id) AS cliques,
           (SELECT COUNT(*) FROM tracking_clicks k WHERE k.campaign_id=c.id AND k.status='converted') AS conversoes
         FROM tracking_campaigns c
         WHERE c.cliente_id=$1 AND c.archived_at IS NULL
         ORDER BY c.created_at DESC`,
        [cliente_id]
      );
      return res.status(200).json(r.rows);
    }

    if (req.method === 'POST') {
      const cliente_id = alvoCliente(req.body.cliente_id);
      if (!cliente_id) return res.status(400).json({ error: 'cliente_id é obrigatório para administrador.' });
      const { name, origin_type = 'bio', rotation_mode = 'single',
              default_message, utm_source, utm_medium, utm_campaign, utm_content,
              conversion_event = 'lead', conversion_auto = false, allowed_domains = [],
              button_text, destinations = [], journey_stages = [] } = req.body;
      if (!name) return res.status(400).json({ error: 'name é obrigatório.' });
      if (!ORIGIN_TYPES.has(origin_type)) return res.status(400).json({ error: 'origin_type inválido.' });
      if (!ROTATION_MODES.has(rotation_mode)) return res.status(400).json({ error: 'rotation_mode inválido.' });
      validarEventoConversao(conversion_event);
      normalizarEtapasJornada(journey_stages);

      // O identificador público é sempre gerado no servidor. O cliente não pode
      // escolher nem alterar a URL, evitando colisões e links previsíveis.
      const slug = randomUUID();
      const destinosNormalizados = normalizarDestinos(destinations);
      validarDestinosPorModo(destinosNormalizados, rotation_mode);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const camp = await client.query(
          `INSERT INTO tracking_campaigns
            (cliente_id, name, slug, origin_type, rotation_mode, default_message,
             utm_source, utm_medium, utm_campaign, utm_content, conversion_event, conversion_auto,
             allowed_domains, button_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [cliente_id, String(name).trim().slice(0, 255), slug, origin_type, rotation_mode,
           default_message || null, utm_source || null, utm_medium || null, utm_campaign || null,
           utm_content || null, conversion_event, conversion_auto === true,
           Array.isArray(allowed_domains) ? allowed_domains.filter(Boolean).slice(0, 20) : [],
           String(button_text || '').trim().slice(0, 80) || null]
        );
        const campaign = camp.rows[0];
        await sincronizarDestinos(client, campaign.id, cliente_id, destinations);
        await sincronizarEtapasJornada(client, campaign.id, cliente_id, journey_stages);
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
      if ('conversion_event' in req.body) validarEventoConversao(req.body.conversion_event);
      if (Array.isArray(destinations)) normalizarDestinos(destinations);
      if (Array.isArray(req.body.journey_stages)) normalizarEtapasJornada(req.body.journey_stages);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const atual = await client.query(
          'SELECT * FROM tracking_campaigns WHERE id=$1 AND cliente_id=$2 AND archived_at IS NULL FOR UPDATE',
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
        delete bodyAtualizacao.slug;

        const campos = ['name','origin_type','rotation_mode','default_message','utm_source','utm_medium','utm_campaign','utm_content','enabled','conversion_event','conversion_auto','allowed_domains','button_text'];
        const sets = [], vals = []; let i = 1;
        for (const campo of campos) {
          if (campo in bodyAtualizacao) {
            sets.push(`${campo}=$${i++}`);
            let valor = bodyAtualizacao[campo];
            if (campo === 'name') valor = String(valor || '').trim().slice(0, 255);
            if (campo === 'allowed_domains') valor = Array.isArray(valor) ? valor.filter(Boolean).slice(0, 20) : [];
            if (campo === 'button_text') valor = String(valor || '').trim().slice(0, 80) || null;
            vals.push(valor);
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
        if (Array.isArray(req.body.journey_stages)) {
          await sincronizarEtapasJornada(client, Number(id), cliente_id, req.body.journey_stages);
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

      // "Excluir" no painel significa arquivar. Cliques, conversões, UTMs e o
      // vínculo dos leads permanecem intactos para não reescrever o histórico.
      const r = await pool.query(
        `UPDATE tracking_campaigns
         SET enabled=false, archived_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND cliente_id=$2 AND archived_at IS NULL
         RETURNING id`,
        [id, cliente_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Não encontrado ou acesso negado.' });
      return res.status(200).json({ archived: r.rows[0].id });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('[tracking-campaigns]', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Não foi possível gerar um identificador único. Tente novamente.' });
    }
    if (/inválid|duplicado|adicione|informe|mantenha|destino único|instância|vinculada|posição|etapa|evento/i.test(err.message || '')) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Erro interno ao salvar o link rastreável.' });
  }
}
