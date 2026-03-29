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

  // Usa o prefixo do cliente ou admin
  const baseName = user.is_admin ? (instanceName || 'admin_master') : `cliente_${user.cliente_id}`;
  const finalInstanceName = baseName.replace(/[^a-zA-Z0-9_]/g, '');

  try {
    const headers = {
      'apikey': EVO_KEY,
      'Content-Type': 'application/json'
    };

    if (action === 'status') {
      // Checa status
      const r = await fetch(`${EVO_URL}/instance/connectionState/${finalInstanceName}`, { headers });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (action === 'create') {
      // Cria a instância (Se já existe a Evolution retorna erro 400 mas não quebra tudo se tratarmos)
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

      // Se já existia, vamos apensar tentar buscar o QRCode
      if (!r.ok && data.message && data.message.includes('already exists')) {
         // Cai no connect pra gerar o QR
      } else if (!r.ok) {
         return res.status(400).json({ error: data.message || 'Erro ao criar instância' });
      }

      // Conecta para pegar o Base64 do QrCode imediatamente
      const rQR = await fetch(`${EVO_URL}/instance/connect/${finalInstanceName}`, { headers });
      const dataQR = await rQR.json();
      return res.status(200).json(dataQR);
    }

    if (action === 'connect') {
      // Tenta gerar/buscar QRCode de uma instância já criada
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
