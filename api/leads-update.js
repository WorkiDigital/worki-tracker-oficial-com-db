import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { id, status, valor_venda } = req.body;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  try {
    const pool = getPool();
    
    // Lista de updates dinâmicos
    const setClauses = [];
    const values = [];
    let queryIndex = 1;

    if (status) {
      setClauses.push(`status = $${queryIndex}`);
      values.push(status);
      queryIndex++;
    }
    
    if (valor_venda !== undefined) {
      setClauses.push(`valor_venda = $${queryIndex}`);
      values.push(valor_venda);
      queryIndex++;
    }

    if (setClauses.length > 0) {
      values.push(id);
      
      let updateQuery;
      if (user.is_admin) {
        updateQuery = `UPDATE leads_tracking SET ${setClauses.join(', ')} WHERE id = $${queryIndex} RETURNING *`;
      } else {
        values.push(user.cliente_id);
        updateQuery = `UPDATE leads_tracking SET ${setClauses.join(', ')} WHERE id = $${queryIndex} AND cliente_id = $${queryIndex + 1} RETURNING *`;
      }

      const updateResult = await pool.query(updateQuery, values);
      
      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: 'Lead não encontrado ou não pertence ao seu cliente.' });
      }

      if (status === 'Vendido' || status === 'Venda') {
        const lead = updateResult.rows[0];
        await sendCapiPurchase(lead, valor_venda, pool);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Leads UPDATE error:', error);
    return res.status(500).json({ error: error.message || 'Erro ao atualizar.' });
  }
}

async function sendCapiPurchase(lead, value, pool) {
  // Pega todos os dados da linha base
  let {
    pixel, ctw_aci_id, event_source_url,
    nome, telefone, cidade, estado, pais, cliente_id
  } = lead;

  if (!pixel && cliente_id) {
     const clientRes = await pool.query('SELECT pixel_padrao FROM clientes WHERE id = $1', [cliente_id]);
     if (clientRes.rows.length > 0) pixel = clientRes.rows[0].pixel_padrao;
  }
  const token = process.env.META_ADS_TOKEN || null;

  // Seção de requisitos CAPI: Se não tiver pixel e token, não podemos mandar
  if (!pixel || !token) {
    console.warn('CAPI não enviada: falta Pixel ou META_ADS_TOKEN para o lead ID', lead.id);
    return;
  }

  // Prepara Hash de user data (SHA256 em lowercase sem espaços especiais)
  const validateHash = str => /^[a-f0-9]{64}$/.test(str);
  const hash = str => validateHash(str) ? str : crypto.createHash('sha256').update((str||'').toLowerCase().trim()).digest('hex');

  const ph = (telefone||'').replace(/\D/g, ''); // só dígitos no telefone
  
  const userData = {
    client_ip_address: lead.client_ip_address || "0.0.0.0",
    client_user_agent: lead.user_agent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    ctwa_clid: ctw_aci_id || undefined, // Parâmetro vital de click/whats
  };

  if (ph) userData.ph = [hash(ph)];
  if (estado) userData.st = [hash(estado)];
  if (cidade) userData.ct = [hash(cidade)];
  if (pais) userData.country = [hash(pais)]; // O ideal é passar em iso ex: 'br'

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000), // momento do click em Vender
        action_source: "website",
        event_source_url: event_source_url || "https://seusite.com",
        user_data: userData,
        custom_data: {
          currency: "BRL",
          value: parseFloat(value || 0)
        }
      }
    ]
  };

  const url = `https://graph.facebook.com/v20.0/${pixel}/events?access_token=${token}`;
  
  try {
    const req = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const resp = await req.json();
    console.log("CAPI Purchase Response:", resp);
  } catch (err) {
    console.error("CAPI error:", err);
  }
}
