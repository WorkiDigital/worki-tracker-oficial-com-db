import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const EVO_URL = process.env.EVOLUTION_API_URL;
  const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;

  if (!EVO_URL || !EVO_KEY) {
    return res.status(500).json({ error: 'Configuração da Evolution API ausente no .env do servidor.' });
  }

  const action = req.query?.action ?? req.body?.action;
  const instanceName = req.query?.instanceName ?? req.body?.instanceName;

  // Prefixo para garantir isolamento
  const prefix = user.is_admin ? 'admin_' : `cliente_${user.cliente_id}_`;
  
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
           const name = i.instance?.instanceName || i.instanceName || i.name;
           return name && String(name).startsWith(prefix);
        }).map(i => {
           const name = i.instance?.instanceName || i.instanceName || i.name;
           const rawState = i.instance?.state || i.instance?.connectionStatus || i.instance?.status || i.state || i.connectionStatus || i.status || '';
           const state = CONNECTED.includes(rawState) ? 'open' : rawState;
           // Extrai cliente_id do prefixo cliente_N_
           const prefixMatch = name.match(/^cliente_(\d+)_/);
           const cliente_id = prefixMatch ? parseInt(prefixMatch[1]) : null;
           return { fullName: name, displayName: name.replace(prefix, ''), state, linked: false, cliente_id };
        });

        // Para admin: também busca instâncias vinculadas via tabela de mapeamento + nomes dos clientes
        if (user.is_admin) {
            try {
                const pool = getPool();
                const mapped = await pool.query('SELECT instance_name, cliente_id FROM instancias_mapeamento');
                for (const row of mapped.rows) {
                    if (myInstances.find(i => i.fullName === row.instance_name)) continue; // já listada
                    const evoInst = instances.find(i => (i.instance?.instanceName || i.instanceName || i.name) === row.instance_name);
                    const rawState = evoInst ? (evoInst.instance?.state || evoInst.instance?.connectionStatus || evoInst.instance?.status || evoInst.state || evoInst.connectionStatus || '') : 'unknown';
                    const state = CONNECTED.includes(rawState) ? 'open' : rawState;
                    myInstances.push({ fullName: row.instance_name, displayName: row.instance_name, state, linked: true, cliente_id: row.cliente_id });
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

        const pool = getPool();
        await pool.query(
            'INSERT INTO instancias_mapeamento (instance_name, cliente_id) VALUES ($1, $2) ON CONFLICT (instance_name) DO UPDATE SET cliente_id=$2',
            [instanceName, cid]
        );

        // Configura webhook N8N na instância existente
        if (process.env.N8N_WEBHOOK_URL) {
            const webhookBody = { webhook: { enabled: true, url: process.env.N8N_WEBHOOK_URL, webhookByEvents: false, webhookBase64: false, events: ["MESSAGES_UPSERT"] } };
            const wRes = await fetch(`${EVO_URL}/webhook/set/${instanceName}`, { method: 'POST', headers, body: JSON.stringify(webhookBody) });
            const wData = wRes.headers.get('content-type')?.includes('json') ? await wRes.json() : {};
            console.log(`[evo-manager] Webhook vinculado em ${instanceName} (${wRes.status}):`, JSON.stringify(wData));
        }

        return res.status(200).json({ message: 'Instância vinculada com sucesso!' });
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

      // Auto-configura webhook do N8N na instância criada
      if (process.env.N8N_WEBHOOK_URL) {
        const webhookBody = {
          webhook: {
            enabled: true,
            url: process.env.N8N_WEBHOOK_URL,
            webhookByEvents: false,
            webhookBase64: false,
            events: ["MESSAGES_UPSERT"]
          }
        };
        const wRes = await fetch(`${EVO_URL}/webhook/set/${finalInstanceName}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(webhookBody)
        });
        const wData = wRes.headers.get('content-type')?.includes('json') ? await wRes.json() : {};
        console.log(`[evo-manager] Webhook set para ${finalInstanceName} (${wRes.status}):`, JSON.stringify(wData));
      } else {
        console.warn('[evo-manager] N8N_WEBHOOK_URL não definida — webhook não configurado');
      }

      const rQR = await fetch(`${EVO_URL}/instance/connect/${finalInstanceName}`, { headers });
      const dataQR = await rQR.json();
      return res.status(200).json(dataQR);
    }

    if (action === 'connect') {
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
      if (!r.ok) return res.status(400).json({ error: data.message || 'Erro ao excluir instância na Evolution' });
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Action inválida.' });
  } catch (error) {
    console.error('Evolution Manager Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
