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

  const { id, status, valor_venda, produto, nome, email, cpf, cidade, estado, endereco } = req.body;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  try {
    const pool = getPool();

    // Lista de updates dinâmicos
    const setClauses = [];
    const values = [];
    let queryIndex = 1;

    if (status)                  { setClauses.push(`status = $${queryIndex++}`);          values.push(status); }
    if (valor_venda !== undefined){ setClauses.push(`valor_venda = $${queryIndex++}`);     values.push(valor_venda); }
    if (produto)                 { setClauses.push(`produto = $${queryIndex++}`);          values.push(produto); }
    if (nome)                    { setClauses.push(`nome = $${queryIndex++}`);             values.push(nome); }
    if (email)                   { setClauses.push(`email = $${queryIndex++}`);            values.push(email); }
    if (cpf)                     { setClauses.push(`cpf = $${queryIndex++}`);              values.push(cpf); }
    if (cidade)                  { setClauses.push(`cidade = $${queryIndex++}`);           values.push(cidade); }
    if (estado)                  { setClauses.push(`estado = $${queryIndex++}`);           values.push(estado); }
    if (endereco)                { setClauses.push(`endereco = $${queryIndex++}`);         values.push(endereco); }

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
  let { pixel, ctw_aci_id, telefone, cidade, estado, cliente_id, page_id } = lead;

  if (!pixel && cliente_id) {
    const clientRes = await pool.query('SELECT pixel_padrao, token_meta FROM clientes WHERE id = $1', [cliente_id]);
    if (clientRes.rows.length > 0) {
      pixel = pixel || clientRes.rows[0].pixel_padrao;
    }
  }
  const token = (cliente_id
    ? (await pool.query('SELECT token_meta FROM clientes WHERE id=$1', [cliente_id])).rows[0]?.token_meta
    : null) || process.env.META_ADS_TOKEN || null;

  if (!pixel || !token) {
    console.warn('CAPI não enviada: falta Pixel ou Token para o lead ID', lead.id);
    return;
  }

  const hash = str => /^[a-f0-9]{64}$/.test(str)
    ? str
    : crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');

  const ph = (telefone || '').replace(/\D/g, '');
  const nomeParts = (lead.nome || '').trim().split(/\s+/);

  const userData = { ctwa_clid: ctw_aci_id || undefined };
  if (ph)           userData.ph          = hash(ph);
  if (nomeParts[0]) userData.fn          = hash(nomeParts[0]);
  if (nomeParts[1]) userData.ln          = hash(nomeParts.slice(1).join(' '));
  if (estado)       userData.st          = hash(estado);
  if (cidade)       userData.ct          = hash(cidade);
  if (lead.email)   userData.em          = hash(lead.email.toLowerCase().trim());
  if (lead.cpf)     userData.external_id = hash(lead.cpf.replace(/\D/g, ''));
  if (page_id)      userData.page_id     = page_id;
  userData.country = hash('br');

  const customData = { currency: 'BRL', value: parseFloat(value || 0) };
  if (lead.produto) customData.content_name = lead.produto;

  const payload = {
    data: [{
      event_name:        'Purchase',
      event_time:        Math.floor(Date.now() / 1000),
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      user_data:         userData,
      custom_data:       customData
    }]
  };

  try {
    const r    = await fetch(`https://graph.facebook.com/v25.0/${pixel}/events?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const resp = await r.json();
    if (resp.events_received) {
      console.log('✅ CAPI Purchase (manual) aceita pela Meta:', resp.fbtrace_id);
    } else {
      console.warn('❌ CAPI Purchase (manual) rejeitada:', resp.error || resp);
    }
  } catch (err) {
    console.error('CAPI error:', err);
  }
}
