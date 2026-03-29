import { verifyAuth } from './_auth.js';

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

  const { action, instanceName } = req.body || req.query;

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
        const myInstances = instances.filter(i => {
           const name = i.instance?.instanceName || i.instanceName || i.name;
           return name && String(name).startsWith(prefix);
        }).map(i => {
           const name = i.instance?.instanceName || i.instanceName || i.name;
           const state = i.instance?.state || i.state;
           return {
               fullName: name,
               displayName: name.replace(prefix, ''),
               state: state
           };
        });
        return res.status(200).json(myInstances);
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
      return res.status(200).json(await r.json());
    }

    return res.status(400).json({ error: 'Action inválida.' });
  } catch (error) {
    console.error('Evolution Manager Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
