import { getPool } from './_db.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = req.body;

  // 1. Filtros iniciais
  if (body.event !== 'messages.upsert') {
    return res.status(200).json({ ignored: true, reason: 'event not messages.upsert' });
  }

  const data = body.data;
  if (!data?.key?.remoteJid?.endsWith('@s.whatsapp.net')) {
    return res.status(200).json({ ignored: true, reason: 'not individual chat' });
  }

  if (!data.message) {
    return res.status(200).json({ ignored: true, reason: 'no message' });
  }

  const instance  = body.instance || '';
  const fromMe    = data.key.fromMe === true;
  const remoteJid = data.key.remoteJidAlt || data.key.remoteJid || '';
  const telefone  = remoteJid.split('@')[0];

  // 2. Identifica cliente_id
  const pool = getPool();
  let cliente_id = null;

  const prefixMatch = String(instance).match(/^cliente_(\d+)_/);
  if (prefixMatch) cliente_id = parseInt(prefixMatch[1]);

  if (!cliente_id) {
    const map = await pool.query(
      'SELECT cliente_id FROM instancias_mapeamento WHERE instance_name = $1',
      [instance]
    );
    if (map.rows.length > 0) cliente_id = map.rows[0].cliente_id;
  }

  if (!cliente_id) {
    return res.status(400).json({ error: 'Instância não reconhecida. Vincule-a a um cliente no painel.' });
  }

  // 3. Busca token e pixel do cliente
  const clientRes = await pool.query(
    'SELECT token_meta, pixel_padrao FROM clientes WHERE id = $1',
    [cliente_id]
  );
  const cliente = clientRes.rows[0] || {};
  const token   = cliente.token_meta || process.env.META_ADS_TOKEN || null;
  const pixel   = cliente.pixel_padrao || null;

  // 4. fromMe = false → LEAD
  if (!fromMe) {
    const ctx      = data.contextInfo || {};
    const adReply  = ctx.externalAdReply || {};
    const ctwaClid = adReply.ctwaClid || null;

    if (!ctwaClid) {
      return res.status(200).json({ ignored: true, reason: 'no ctwaClid — not from ad' });
    }

    const sourceId            = adReply.sourceId || null;
    const event_source_url    = adReply.sourceUrl || '';
    const anuncio_thumbnail_url = adReply.thumbnailUrl || '';
    const plataforma          = ctx.entryPointConversionApp || (adReply.mediaType === 2 ? 'instagram' : 'facebook');
    const nome                = data.pushName || '';
    const mensagem_recebida   = data.message?.conversation || data.message?.extendedTextMessage?.text || '';

    // 5. Chama Meta Graph API para enriquecer UTMs e page_id
    let utm_campaign = null, utm_medium = null, utm_content = null, page_id = null;

    if (sourceId && token) {
      try {
        const metaUrl = `https://graph.facebook.com/v20.0/${sourceId}?fields=name,adset{name},campaign{name},tracking_specs&access_token=${token}`;
        const metaRes = await fetch(metaUrl);
        const meta    = await metaRes.json();

        utm_campaign = meta.campaign?.name || null;
        utm_medium   = meta.adset?.name   || null;
        utm_content  = meta.name          || null;

        const specs = Array.isArray(meta.tracking_specs) ? meta.tracking_specs : [];
        for (const spec of specs) {
          if (spec.page?.length > 0) { page_id = String(spec.page[0]); break; }
        }
      } catch (e) {
        console.warn('[webhook-evo] Meta API error:', e.message);
      }
    }

    // 6. Salva lead no banco
    const insertResult = await pool.query(`
      INSERT INTO leads_tracking (
        cliente_id, nome, telefone, mensagem_recebida, ctw_aci_id, source_id,
        event_source_url, anuncio_thumbnail_url, instancia, status, event_time,
        utm_campaign, utm_medium, utm_content, page_id, plataforma
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Lead',to_timestamp($10),$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      cliente_id, nome, telefone, mensagem_recebida,
      ctwaClid, sourceId || '',
      event_source_url, anuncio_thumbnail_url,
      instance, Math.floor(Date.now() / 1000),
      utm_campaign, utm_medium, utm_content, page_id, plataforma
    ]);

    const lead = insertResult.rows[0];

    // 7. Dispara CAPI Lead
    await sendCapiLead(lead, pixel, token);

    return res.status(200).json({ success: true, message: 'Lead salvo com sucesso', lead });
  }

  // 4b. fromMe = true → COMPRA
  if (fromMe) {
    const msg = data.message?.conversation || data.message?.extendedTextMessage?.text || '';

    const get = (labels) => {
      for (const label of labels) {
        const m = msg.match(new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i'));
        if (m) return m[1].trim();
      }
      return null;
    };

    const valorRaw  = get(['valor', 'venda', 'total']) || '0';
    const valor     = parseFloat(valorRaw.replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;

    if (valor <= 0) {
      return res.status(200).json({ ignored: true, reason: 'atendente message without valor — ignored' });
    }

    const cidade = get(['cidade']);
    const estado = get(['estado', 'uf']);
    const nome   = get(['nome', 'cliente']);

    // Busca lead mais recente desse telefone para o cliente
    const leadQuery = await pool.query(
      'SELECT * FROM leads_tracking WHERE telefone = $1 AND cliente_id = $2 ORDER BY id DESC LIMIT 1',
      [telefone, cliente_id]
    );

    if (leadQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Nenhum lead encontrado com esse telefone.' });
    }

    const updateResult = await pool.query(`
      UPDATE leads_tracking
      SET status = 'Vendido', valor_venda = $1,
          cidade = COALESCE($2, cidade),
          estado = COALESCE($3, estado),
          nome   = COALESCE($4, nome)
      WHERE id = $5 RETURNING *
    `, [valor, cidade || null, estado || null, nome || null, leadQuery.rows[0].id]);

    const leadAtualizado = updateResult.rows[0];

    await sendCapiPurchase(leadAtualizado, pixel, token);

    return res.status(200).json({ success: true, message: 'Compra registrada e CAPI enviada', lead: leadAtualizado });
  }
}

// ─── CAPI helpers ────────────────────────────────────────────────────────────

const hash = str =>
  /^[a-f0-9]{64}$/.test(str)
    ? str
    : crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');

async function sendCapiLead(lead, pixel, token) {
  if (!pixel || !token || !lead.ctw_aci_id) return;

  const ph = (lead.telefone || '').replace(/\D/g, '');

  const userData = {
    client_ip_address: '0.0.0.0',
    client_user_agent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    ctwa_clid: lead.ctw_aci_id,
  };

  if (ph)          userData.ph      = [hash(ph)];
  if (lead.page_id) userData.page_id = lead.page_id;

  const payload = {
    data: [{
      event_name:        'Lead',
      event_time:        Math.floor(Date.now() / 1000),
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      user_data:         userData,
    }]
  };

  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${pixel}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('[webhook-evo] CAPI Lead:', await r.json());
  } catch (e) { console.error('[webhook-evo] CAPI Lead error:', e.message); }
}

async function sendCapiPurchase(lead, pixel, token) {
  if (!pixel || !token) return;

  const ph = (lead.telefone || '').replace(/\D/g, '');

  const userData = {
    client_ip_address: '0.0.0.0',
    client_user_agent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    ctwa_clid:         lead.ctw_aci_id || undefined,
  };

  if (ph)           userData.ph      = [hash(ph)];
  if (lead.estado)  userData.st      = [hash(lead.estado)];
  if (lead.cidade)  userData.ct      = [hash(lead.cidade)];
  if (lead.page_id) userData.page_id = lead.page_id;
  userData.country = [hash('br')];

  const payload = {
    data: [{
      event_name:        'Purchase',
      event_time:        Math.floor(Date.now() / 1000),
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      user_data:         userData,
      custom_data: {
        currency: 'BRL',
        value:    parseFloat(lead.valor_venda || 0)
      }
    }]
  };

  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${pixel}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('[webhook-evo] CAPI Purchase:', await r.json());
  } catch (e) { console.error('[webhook-evo] CAPI Purchase error:', e.message); }
}
