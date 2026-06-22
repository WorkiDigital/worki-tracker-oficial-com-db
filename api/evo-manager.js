import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

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

function montarWebhookBody() {
  let webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return null;
  if (process.env.WEBHOOK_SECRET && process.env.WEBHOOK_SECRET_IN_URL === 'true') {
    const sep = webhookUrl.includes('?') ? '&' : '?';
    webhookUrl += `${sep}secret=${process.env.WEBHOOK_SECRET}`;
  }
  return {
    webhook: {
      enabled: true,
      url: webhookUrl,
      webhookByEvents: false,
      webhookBase64: false,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      webhookSecret: process.env.WEBHOOK_SECRET || undefined
    }
  };
}

async function configurarWebhookEvolution(EVO_URL, headers, instanceName) {
  const webhookBody = montarWebhookBody();
  if (!webhookBody) throw new Error('WEBHOOK_URL não configurada no servidor.');
  const response = await fetch(`${EVO_URL}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(webhookBody)
  });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : {};
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Evolution recusou o webhook (HTTP ${response.status}).`);
  }
  const verifyResponse = await fetch(`${EVO_URL}/webhook/find/${instanceName}`, { headers });
  const saved = verifyResponse.headers.get('content-type')?.includes('json') ? await verifyResponse.json() : {};
  if (!verifyResponse.ok) {
    throw new Error(`Webhook enviado, mas não foi possível confirmar na Evolution (HTTP ${verifyResponse.status}).`);
  }
  const esperado = webhookBody.webhook;
  const eventosSalvos = Array.isArray(saved?.events) ? saved.events : [];
  const eventosAusentes = esperado.events.filter(event => !eventosSalvos.includes(event));
  if (saved?.url !== esperado.url || saved?.enabled !== true || eventosAusentes.length) {
    throw new Error(
      `Evolution não persistiu o webhook corretamente${eventosAusentes.length ? `; eventos ausentes: ${eventosAusentes.join(', ')}` : ''}.`
    );
  }
  console.log(`[evo-manager] Webhook set para ${instanceName} (${response.status}):`, JSON.stringify(data));
  return saved;
}

export default async function handler(req, res) {
  if (cors(req, res, ['POST', 'GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const EVO_URL = process.env.EVOLUTION_API_URL;
  const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;

  if (!EVO_URL || !EVO_KEY) {
    return res.status(500).json({ error: 'Configuração da Evolution API ausente no .env do servidor.' });
  }

  const action = req.query?.action ?? req.body?.action;
  const instanceName = req.query?.instanceName ?? req.body?.instanceName;

  // Prefixo para garantir isolamento
  // Admin pode criar instância para cliente específico passando target_cliente_id
  const targetClienteId = req.body?.target_cliente_id || req.query?.target_cliente_id || null;
  const prefix = user.is_admin
    ? (targetClienteId ? `cliente_${targetClienteId}_` : 'admin_')
    : `cliente_${user.cliente_id}_`;

  // Nome final seguro para criação/ação específica (ex: admin_suporte)
  const safeName = instanceName ? instanceName.replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
  const finalInstanceName = `${prefix}${safeName}`;

  try {
    const headers = {
      'apikey': EVO_KEY,
      'Content-Type': 'application/json'
    };

    if (action === 'list') {
        const r = await fetch(`${EVO_URL}/instance/fetchInstances`, { headers });
        const data = await r.json();
        const instances = Array.isArray(data) ? data : [];

        const CONNECTED = ['open','connected','online','CONNECTED'];

        // Instâncias com prefixo do usuário
        const myInstances = instances.filter(i => {
           const name = getInstanceName(i);
           return name && String(name).startsWith(prefix);
        }).map(i => {
           const name = getInstanceName(i);
           const rawState = i.instance?.state || i.instance?.connectionStatus || i.instance?.status || i.state || i.connectionStatus || i.status || '';
           const state = CONNECTED.includes(rawState) ? 'open' : rawState;
           // Extrai cliente_id do prefixo cliente_N_
           const prefixMatch = name.match(/^cliente_(\d+)_/);
           const cliente_id = prefixMatch ? parseInt(prefixMatch[1]) : null;
           return { fullName: name, displayName: name.replace(prefix, ''), state, linked: false, cliente_id, whatsapp_number: getInstancePhone(i) };
        });

        // Busca instâncias vinculadas via tabela de mapeamento (admin: todas; cliente: só as suas)
        try {
            const pool = getPool();
            const mapped = user.is_admin
                ? (targetClienteId
                    ? await pool.query('SELECT instance_name, cliente_id FROM instancias_mapeamento WHERE cliente_id = $1', [targetClienteId])
                    : await pool.query('SELECT instance_name, cliente_id FROM instancias_mapeamento'))
                : await pool.query('SELECT instance_name, cliente_id FROM instancias_mapeamento WHERE cliente_id = $1', [user.cliente_id]);

            for (const row of mapped.rows) {
                    if (myInstances.find(i => i.fullName === row.instance_name)) continue; // já listada
                    const evoInst = instances.find(i => getInstanceName(i) === row.instance_name);
                    const rawState = evoInst ? (evoInst.instance?.state || evoInst.instance?.connectionStatus || evoInst.instance?.status || evoInst.state || evoInst.connectionStatus || '') : 'unknown';
                    const state = CONNECTED.includes(rawState) ? 'open' : rawState;
                    myInstances.push({ fullName: row.instance_name, displayName: row.instance_name, state, linked: true, cliente_id: row.cliente_id, whatsapp_number: getInstancePhone(evoInst) });
                }

                // Busca nomes dos clientes para agrupamento
                const clientIds = [...new Set(myInstances.filter(i => i.cliente_id).map(i => i.cliente_id))];
                if (clientIds.length > 0) {
                    const clientRes = await pool.query('SELECT id, nome FROM clientes WHERE id = ANY($1)', [clientIds]);
                    const clientMap = {};
                    for (const row of clientRes.rows) clientMap[row.id] = row.nome;
                    for (const inst of myInstances) {
                        if (inst.cliente_id && clientMap[inst.cliente_id]) {
                            inst.cliente_nome = clientMap[inst.cliente_id];
                        }
                    }
                }
        } catch (dbErr) {
            console.warn('[evo-manager] Erro ao buscar dados do banco:', dbErr.message);
        }

        return res.status(200).json(myInstances);
    }

    if (action === 'list-all') {
        if (!user.is_admin) return res.status(403).json({ error: 'Apenas admin pode listar todas as instâncias.' });
        const r = await fetch(`${EVO_URL}/instance/fetchInstances`, { headers });
        const data = await r.json();
        const instances = Array.isArray(data) ? data : [];
        return res.status(200).json(instances.map(i => {
            const name = i.instance?.instanceName || i.instanceName || i.name;
            const rawState = i.instance?.state || i.state || '';
            const state = ['open','connected','online'].includes(rawState) ? 'open' : rawState;
            return { fullName: name, state };
        }));
    }

    if (action === 'link') {
        if (!user.is_admin) return res.status(403).json({ error: 'Apenas admin pode vincular instâncias.' });
        const { cliente_id: cid } = req.body;
        if (!cid) return res.status(400).json({ error: 'cliente_id obrigatório' });
        if (!instanceName) return res.status(400).json({ error: 'instanceName obrigatório' });

        await configurarWebhookEvolution(EVO_URL, headers, instanceName);

        const pool = getPool();
        await pool.query(
            'INSERT INTO instancias_mapeamento (instance_name, cliente_id) VALUES ($1, $2) ON CONFLICT (instance_name) DO UPDATE SET cliente_id=$2',
            [instanceName, cid]
        );

        return res.status(200).json({
          message: 'Instância vinculada e webhook confirmado com sucesso!',
          webhook_configured: true
        });
    }

    if (action === 'status') {
      const r = await fetch(`${EVO_URL}/instance/connectionState/${finalInstanceName}`, { headers });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (action === 'create') {
      const body = {
        instanceName: finalInstanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS"
      };
      
      let r = await fetch(`${EVO_URL}/instance/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      let data = await r.json();

      if (!r.ok && data.message && data.message.includes('already exists')) {
         // Ignores and proceeds to fetch QR
      } else if (!r.ok) {
         return res.status(400).json({ error: data.message || 'Erro ao criar instância' });
      }

      await configurarWebhookEvolution(EVO_URL, headers, finalInstanceName);

      const ownerClienteId = user.is_admin ? Number(targetClienteId) : Number(user.cliente_id);
      if (ownerClienteId) {
        const pool = getPool();
        await pool.query(
          `INSERT INTO instancias_mapeamento (instance_name, cliente_id)
           VALUES ($1, $2)
           ON CONFLICT (instance_name) DO UPDATE SET cliente_id=EXCLUDED.cliente_id`,
          [finalInstanceName, ownerClienteId]
        );
      }

      const rQR = await fetch(`${EVO_URL}/instance/connect/${finalInstanceName}`, { headers });
      const dataQR = await rQR.json();
      return res.status(200).json(dataQR);
    }

    if (action === 'connect') {
      await configurarWebhookEvolution(EVO_URL, headers, finalInstanceName);
      const r = await fetch(`${EVO_URL}/instance/connect/${finalInstanceName}`, { headers });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (action === 'logout') {
      const r = await fetch(`${EVO_URL}/instance/logout/${finalInstanceName}`, { method: 'DELETE', headers });
      return res.status(200).json(await r.json());
    }

    if (action === 'delete') {
      const r = await fetch(`${EVO_URL}/instance/delete/${finalInstanceName}`, { method: 'DELETE', headers });
      const data = await r.json();
      
      // Se não for OK e não for erro de "não encontrado", retorna erro.
      // Caso seja "não encontrado", prosseguimos para limpar do nosso banco local.
      const isNotFound = !r.ok && (data.message?.toLowerCase().includes('not found') || r.status === 404);

      if (!r.ok && !isNotFound) {
          return res.status(400).json({ error: data.message || 'Erro ao excluir instância na Evolution' });
      }

      // Remove também da tabela de mapeamento (se existir)
      try {
        const pool = getPool();
        await pool.query(user.is_admin
          ? 'DELETE FROM instancias_mapeamento WHERE instance_name = $1'
          : 'DELETE FROM instancias_mapeamento WHERE instance_name = $1 AND cliente_id = $2',
          user.is_admin ? [finalInstanceName] : [finalInstanceName, user.cliente_id]);
        // Tenta também com o nome original (instâncias vinculadas usam nome sem prefixo)
        await pool.query(user.is_admin
          ? 'DELETE FROM instancias_mapeamento WHERE instance_name = $1'
          : 'DELETE FROM instancias_mapeamento WHERE instance_name = $1 AND cliente_id = $2',
          user.is_admin ? [instanceName] : [instanceName, user.cliente_id]);
      } catch(dbErr) { console.warn('[evo-manager] Erro ao limpar mapeamento:', dbErr.message); }

      return res.status(200).json(data);
    }

    if (action === 'unlink') {
      if (!instanceName) return res.status(400).json({ error: 'instanceName obrigatório' });
      const pool = getPool();
      const result = await pool.query(user.is_admin
        ? 'DELETE FROM instancias_mapeamento WHERE instance_name = $1 RETURNING id'
        : 'DELETE FROM instancias_mapeamento WHERE instance_name = $1 AND cliente_id = $2 RETURNING id',
        user.is_admin ? [instanceName] : [instanceName, user.cliente_id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Instância não encontrada na tabela de mapeamento.' });
      }
      return res.status(200).json({ ok: true, message: 'Instância desvinculada com sucesso.' });
    }

    if (action === 'fetchGroups') {
      const target = req.query.instanceName || req.body?.instanceName;
      if (!target) return res.status(400).json({ error: 'instanceName obrigatório' });
      const r = await fetch(`${EVO_URL}/group/fetchAllGroups/${target}`, { headers });
      if (!r.ok) return res.status(r.status).json({ error: 'Erro ao buscar grupos na Evolution' });
      const data = await r.json();
      const grupos = Array.isArray(data) ? data : [];
      return res.status(200).json(grupos.map(g => ({
        id:         g.id,
        subject:    g.subject,
        size:       g.size,
        pictureUrl: g.pictureUrl || null,
      })));
    }

    return res.status(400).json({ error: 'Action inválida.' });
  } catch (error) {
    console.error('Evolution Manager Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
