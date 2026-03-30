import { getPool } from './_db.js';
import crypto from 'crypto';

function saveLog(instance, cliente_id, level, tag, message, data) {
  try {
    getPool().query(
      `INSERT INTO webhook_logs (instance, cliente_id, level, tag, message, data)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [instance || null, cliente_id || null, level, tag, message, data ? JSON.stringify(data) : null]
    ).catch(() => {});
  } catch (_) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body     = req.body;
  const instance = body.instance || '';
  let   cid      = null; // será preenchido após identificar o cliente

  const log  = (tag, msg, data) => { console.log(`[evo:${tag}]`, msg, data !== undefined ? JSON.stringify(data) : ''); saveLog(instance, cid, 'info', tag, msg, data); };
  const warn = (tag, msg, data) => { console.warn(`[evo:${tag}]`, msg, data !== undefined ? JSON.stringify(data) : ''); saveLog(instance, cid, 'warn', tag, msg, data); };

  // 1. Filtros iniciais
  if (body.event !== 'messages.upsert') {
    log('filter', 'Ignorado — evento não é messages.upsert', { event: body.event });
    return res.status(200).json({ ignored: true, reason: 'event not messages.upsert' });
  }

  const data = body.data;
  if (!data?.key?.remoteJid?.endsWith('@s.whatsapp.net')) {
    log('filter', 'Ignorado — não é chat individual', { remoteJid: data?.key?.remoteJid });
    return res.status(200).json({ ignored: true, reason: 'not individual chat' });
  }

  if (!data.message) {
    log('filter', 'Ignorado — sem message no payload');
    return res.status(200).json({ ignored: true, reason: 'no message' });
  }

  const fromMe   = data.key.fromMe === true;
  const remoteJid = data.key.remoteJidAlt || data.key.remoteJid || '';
  const telefone  = remoteJid.split('@')[0];

  log('recv', 'Mensagem recebida', { instance, fromMe, telefone, pushName: data.pushName });

  // 2. Identifica cliente_id
  const pool = getPool();
  let cliente_id = null;

  const prefixMatch = String(instance).match(/^cliente_(\d+)_/);
  if (prefixMatch) {
    cliente_id = parseInt(prefixMatch[1]);
    log('auth', 'Cliente identificado via prefixo', { instance, cliente_id });
  }

  if (!cliente_id) {
    const map = await pool.query(
      'SELECT cliente_id FROM instancias_mapeamento WHERE instance_name = $1',
      [instance]
    );
    if (map.rows.length > 0) {
      cliente_id = map.rows[0].cliente_id;
      log('auth', 'Cliente identificado via instancias_mapeamento', { instance, cliente_id });
    }
  }

  if (!cliente_id) {
    warn('auth', 'Instância não reconhecida', { instance });
    return res.status(400).json({ error: 'Instância não reconhecida. Vincule-a a um cliente no painel.' });
  }

  cid = cliente_id; // atualiza contexto dos logs

  // 3. Busca token e pixel do cliente
  const clientRes = await pool.query(
    'SELECT token_meta, pixel_padrao FROM clientes WHERE id = $1',
    [cliente_id]
  );
  const cliente = clientRes.rows[0] || {};
  const token   = cliente.token_meta || process.env.META_ADS_TOKEN || null;
  const pixel   = cliente.pixel_padrao || null;

  log('auth', 'Pixel/Token do cliente', { cliente_id, pixel: pixel || 'AUSENTE', token: token ? 'OK' : 'AUSENTE' });

  // 4. fromMe = false → LEAD
  if (!fromMe) {
    const ctx      = data.contextInfo || {};
    const adReply  = ctx.externalAdReply || {};
    const ctwaClid = adReply.ctwaClid || null;

    if (!ctwaClid) {
      log('lead', 'Ignorado — sem ctwaClid (não veio de anúncio)', { telefone });
      return res.status(200).json({ ignored: true, reason: 'no ctwaClid — not from ad' });
    }

    const sourceId              = adReply.sourceId || null;
    const event_source_url      = adReply.sourceUrl || '';
    const anuncio_thumbnail_url = adReply.thumbnailUrl || '';
    const plataforma            = ctx.entryPointConversionApp || (adReply.mediaType === 2 ? 'instagram' : 'facebook');
    const nome                  = data.pushName || '';
    const mensagem_recebida     = data.message?.conversation || data.message?.extendedTextMessage?.text || '';

    log('lead', 'Lead de anúncio identificado', { telefone, nome, plataforma, sourceId, ctwaClid: ctwaClid.substring(0, 20) + '...' });

    // 5. Meta Graph API → UTMs e page_id
    let utm_campaign = null, utm_medium = null, utm_content = null, page_id = null;

    if (sourceId && token) {
      log('meta-api', 'Buscando dados do anúncio', { sourceId });
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

        log('meta-api', 'UTMs e page_id extraídos', { utm_campaign, utm_medium, utm_content, page_id });
      } catch (e) {
        warn('meta-api', 'Erro ao buscar dados do anúncio', { error: e.message });
      }
    } else {
      warn('meta-api', 'Pulou busca Meta API', { sourceId: sourceId || 'AUSENTE', token: token ? 'OK' : 'AUSENTE' });
    }

    // 6. Salva lead no banco
    log('db', 'Salvando lead no banco', { telefone, nome, plataforma });
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
    log('db', 'Lead salvo com sucesso', { id: lead.id, status: lead.status });

    // 7. CAPI Lead
    await sendCapiLead(lead, pixel, token, log, warn);

    return res.status(200).json({ success: true, message: 'Lead salvo com sucesso', lead });
  }

  // 4b. fromMe = true → COMPRA
  if (fromMe) {
    const msg = data.message?.conversation || data.message?.extendedTextMessage?.text || data.message?.imageMessage?.caption || data.message?.documentMessage?.caption || '';

    log('purchase', 'Mensagem do atendente recebida', { telefone, preview: msg.substring(0, 80) });

    const get = (labels) => {
      for (const label of labels) {
        const m = msg.match(new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i'));
        if (m) return m[1].trim();
      }
      return null;
    };

    const valorRaw = get(['valor', 'venda', 'total']) || '0';
    const valor    = parseFloat(valorRaw.replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;

    if (valor <= 0) {
      log('purchase', 'Ignorado — sem valor na mensagem', { telefone, msg: msg.substring(0, 80) });
      return res.status(200).json({ ignored: true, reason: 'atendente message without valor — ignored' });
    }

    const cidade = get(['cidade']);
    const estado = get(['estado', 'uf']);
    const nome   = get(['nome', 'cliente']);

    log('purchase', 'Dados de venda extraídos', { valor, cidade, estado, nome });

    const leadQuery = await pool.query(
      'SELECT * FROM leads_tracking WHERE telefone = $1 AND cliente_id = $2 ORDER BY id DESC LIMIT 1',
      [telefone, cliente_id]
    );

    if (leadQuery.rows.length === 0) {
      warn('purchase', 'Nenhum lead encontrado para registrar venda', { telefone, cliente_id });
      return res.status(404).json({ error: 'Nenhum lead encontrado com esse telefone.' });
    }

    log('purchase', 'Lead encontrado para atualizar', { id: leadQuery.rows[0].id, status_atual: leadQuery.rows[0].status });

    const updateResult = await pool.query(`
      UPDATE leads_tracking
      SET status = 'Vendido', valor_venda = $1,
          cidade = COALESCE($2, cidade),
          estado = COALESCE($3, estado),
          nome   = COALESCE($4, nome)
      WHERE id = $5 RETURNING *
    `, [valor, cidade || null, estado || null, nome || null, leadQuery.rows[0].id]);

    const leadAtualizado = updateResult.rows[0];
    log('purchase', 'Lead atualizado para Vendido', { id: leadAtualizado.id, valor_venda: leadAtualizado.valor_venda });

    await sendCapiPurchase(leadAtualizado, pixel, token, log, warn);

    return res.status(200).json({ success: true, message: 'Compra registrada e CAPI enviada', lead: leadAtualizado });
  }
}

// ─── CAPI helpers ────────────────────────────────────────────────────────────

const hash = str =>
  /^[a-f0-9]{64}$/.test(str)
    ? str
    : crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');

async function sendCapiLead(lead, pixel, token, log, warn) {
  if (!pixel || !token || !lead.ctw_aci_id) {
    warn('capi-lead', 'CAPI Lead não disparada', { pixel: pixel || 'AUSENTE', token: token ? 'OK' : 'AUSENTE', ctw_aci_id: lead.ctw_aci_id || 'AUSENTE' });
    return;
  }

  const ph = (lead.telefone || '').replace(/\D/g, '');
  const userData = { ctwa_clid: lead.ctw_aci_id };
  if (ph)           userData.ph      = hash(ph);
  if (lead.page_id) userData.page_id = lead.page_id;

  const payload = {
    data: [{
      event_name:        'LeadSubmitted',
      event_time:        Math.floor(Date.now() / 1000),
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      user_data:         userData,
    }]
  };

  log('capi-lead', 'Disparando CAPI Lead', { pixel, lead_id: lead.id, page_id: lead.page_id });
  try {
    const r    = await fetch(`https://graph.facebook.com/v25.0/${pixel}/events?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const resp = await r.json();
    if (resp.events_received) {
      log('capi-lead', '✅ CAPI Lead aceita pela Meta', { events_received: resp.events_received, fbtrace_id: resp.fbtrace_id });
    } else {
      warn('capi-lead', '❌ CAPI Lead rejeitada pela Meta', resp.error || resp);
    }
  } catch (e) { warn('capi-lead', 'Erro de rede ao disparar CAPI Lead', { error: e.message }); }
}

async function sendCapiPurchase(lead, pixel, token, log, warn) {
  if (!pixel || !token) {
    warn('capi-purchase', 'CAPI Purchase não disparada', { pixel: pixel || 'AUSENTE', token: token ? 'OK' : 'AUSENTE' });
    return;
  }

  const ph = (lead.telefone || '').replace(/\D/g, '');
  const nomeParts = (lead.nome || '').trim().split(/\s+/);
  const userData = { ctwa_clid: lead.ctw_aci_id || undefined };
  if (ph)           userData.ph      = hash(ph);
  if (nomeParts[0]) userData.fn      = hash(nomeParts[0]);
  if (nomeParts[1]) userData.ln      = hash(nomeParts.slice(1).join(' '));
  if (lead.estado)  userData.st      = hash(lead.estado);
  if (lead.cidade)  userData.ct      = hash(lead.cidade);
  if (lead.page_id) userData.page_id = lead.page_id;
  userData.country = hash('br');

  const payload = {
    data: [{
      event_name:        'Purchase',
      event_time:        Math.floor(Date.now() / 1000),
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      user_data:         userData,
      custom_data:       { currency: 'BRL', value: parseFloat(lead.valor_venda || 0) }
    }]
  };

  log('capi-purchase', 'Disparando CAPI Purchase', { pixel, lead_id: lead.id, valor: lead.valor_venda });
  try {
    const r    = await fetch(`https://graph.facebook.com/v25.0/${pixel}/events?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const resp = await r.json();
    if (resp.events_received) {
      log('capi-purchase', '✅ CAPI Purchase aceita pela Meta', { events_received: resp.events_received, fbtrace_id: resp.fbtrace_id });
    } else {
      warn('capi-purchase', '❌ CAPI Purchase rejeitada pela Meta', resp.error || resp);
    }
  } catch (e) { warn('capi-purchase', 'Erro de rede ao disparar CAPI Purchase', { error: e.message }); }
}
