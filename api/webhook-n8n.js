import { getPool } from './_db.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  let {
    cliente_id,
    instance,   // "cliente_7_NomeLoja" — alternativa ao cliente_id explícito
    evento,     // 'lead' ou 'purchase'
    nome,
    telefone,
    mensagem_recebida,
    ctw_aci_id,
    source_id,
    event_source_url,
    anuncio_thumbnail_url,
    cidade,
    estado,
    valor_venda
  } = req.body;

  // Auto-derivar cliente_id do nome da instância Evolution (ex: "cliente_7_Loja" → 7)
  if (!cliente_id && instance) {
    const match = String(instance).match(/^cliente_(\d+)_/);
    if (match) cliente_id = parseInt(match[1]);
  }

  if (!cliente_id || !telefone) {
    return res.status(400).json({ error: 'Informe cliente_id ou um campo instance com prefixo "cliente_N_". telefone também é obrigatório.' });
  }

  try {
    const pool = getPool();

    if (evento === 'purchase') {
      // 1. Achar o lead mais recente com esse telefone para o cliente
      const leadQuery = await pool.query(
        'SELECT * FROM leads_tracking WHERE telefone = $1 AND cliente_id = $2 ORDER BY id DESC LIMIT 1',
        [telefone, cliente_id]
      );

      if (leadQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Nenhum lead encontrado com esse telefone para registrar a compra.' });
      }

      const leadId = leadQuery.rows[0].id;

      // 2. Atualiza via banco (marcando como Venda e colocando cidade/estado)
      const updateResult = await pool.query(`
        UPDATE leads_tracking
        SET status = 'Vendido', valor_venda = $1, cidade = COALESCE($2, cidade), estado = COALESCE($3, estado)
        WHERE id = $4 RETURNING *
      `, [valor_venda || 0, cidade || null, estado || null, leadId]);

      const leadAtualizado = updateResult.rows[0];

      // 3. Dispara a CAPI no backend seguro
      await sendCapiPurchase(leadAtualizado, pool);

      return res.status(200).json({ success: true, message: 'Compra registrada e CAPI enviada', lead: leadAtualizado });

    } else {
      // É um LEAD NOVO
      const insertResult = await pool.query(`
        INSERT INTO leads_tracking (
          cliente_id, nome, telefone, mensagem_recebida, ctw_aci_id, source_id, 
          event_source_url, anuncio_thumbnail_url, status, event_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pendente', to_timestamp($9))
        RETURNING *
      `, [
        cliente_id,
        nome,
        telefone,
        mensagem_recebida || '',
        ctw_aci_id || '',
        source_id || '',
        event_source_url || '',
        anuncio_thumbnail_url || '',
        Math.floor(Date.now() / 1000)
      ]);

      return res.status(200).json({ success: true, message: 'Lead salvo com sucesso', lead: insertResult.rows[0] });
    }

  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function sendCapiPurchase(lead, pool) {
  let { pixel, token, ctw_aci_id, source_id, event_source_url, telefone, cidade, estado, cliente_id, valor_venda } = lead;

  const clientRes = await pool.query('SELECT pixel_padrao, token_meta FROM clientes WHERE id = $1', [cliente_id]);
  if (clientRes.rows.length > 0) {
    pixel = pixel || clientRes.rows[0].pixel_padrao;
    token = token || clientRes.rows[0].token_meta;
  }

  if (!pixel || !token) return;

  const hash = str => /^[a-f0-9]{64}$/.test(str) ? str : crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');
  const ph = (telefone || '').replace(/\D/g, ''); 

  const userData = {
    client_ip_address: lead.client_ip_address || "0.0.0.0",
    client_user_agent: lead.user_agent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    ctwa_clid: ctw_aci_id || undefined, 
  };

  if (ph) userData.ph = [hash(ph)];
  if (estado) userData.st = [hash(estado)];
  if (cidade) userData.ct = [hash(cidade)];
  userData.country = [hash('br')]; 

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000), 
        action_source: "website",
        event_source_url: event_source_url || "https://seusite.com",
        user_data: userData,
        custom_data: {
          currency: "BRL",
          value: parseFloat(valor_venda || 0)
        }
      }
    ]
  };

  try {
    const req = await fetch(`https://graph.facebook.com/v20.0/${pixel}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log("CAPI Purchase Response:", await req.json());
  } catch (err) { }
}
