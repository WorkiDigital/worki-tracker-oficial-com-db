import { getPool } from './_db.js';
import crypto from 'crypto';
import { diffInHours } from './_metrics_helper.js';

function normalizarNome(str) {
  if (!str) return '';
  return str
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/[^\p{L}\p{N}\s'.,-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTemplate(template) {
  const map = {};
  for (const line of template.split('\n')) {
    const m = line.match(/^(.+?):\s*\{(\w+)\}/);
    if (m) map[m[2].trim()] = m[1].trim();
  }
  return map;
}

/**
 * Fase 2: Parser Inteligente Aprimorado
 */
function getMessageFlags(message) {
  const patterns = {
    orcamento: /quanto|preço|valor|parcela|custo/i,
    alta_intencao: /vou (comprar|fechar)|estou decidid[oa]|quero fechar|como pago/i,
    urgente: /urgente|hoje|agora|rápido|imediato/i,
    comparando: /comparando|outros|concorrente|em outro lugar/i
  };

  return {
    tem_orcamento: patterns.orcamento.test(message),
    alta_intencao: patterns.alta_intencao.test(message),
    urgente: patterns.urgente.test(message),
    comparando: patterns.comparando.test(message)
  };
}

function calculateLeadScore(flags, lastInteraction) {
  let score = 0;
  if (flags.tem_orcamento) score += 20;
  if (flags.alta_intencao) score += 40;
  if (flags.urgente) score += 30;
  if (flags.comparando) score -= 10;

  if (lastInteraction) {
    const horasSemResposta = diffInHours(lastInteraction, new Date());
    if (horasSemResposta < 1) score += 10;
    else if (horasSemResposta > 24) score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

function saveLog(instance, cliente_id, level, tag, message, data) {
  try {
    getPool().query(
      `INSERT INTO webhook_logs (instance, cliente_id, level, tag, message, data)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [instance || null, cliente_id || null, level, tag, message, data ? JSON.stringify(data) : null]
    ).catch(() => { });
  } catch (_) { }
}

import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['POST'], { public: true })) return;

  // Valida segredo do webhook (se configurado em WEBHOOK_SECRET)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'WEBHOOK_SECRET não configurado.' });
  }
  if (webhookSecret) {
    const receivedSecret = req.query.secret || req.headers['x-webhook-secret'] || req.headers['x-api-key'] || req.headers['apikey'];
    if (receivedSecret !== webhookSecret) {
      return res.status(401).json({ error: 'Webhook secret inválido ou ausente.' });
    }
  }

  const body = req.body;
  const instance = body.instance || '';
  let cid = null;

  const log = (tag, msg, data) => { console.log(`[evo:${tag}]`, msg, data !== undefined ? JSON.stringify(data) : ''); saveLog(instance, cid, 'info', tag, msg, data); };
  const warn = (tag, msg, data) => { console.warn(`[evo:${tag}]`, msg, data !== undefined ? JSON.stringify(data) : ''); saveLog(instance, cid, 'warn', tag, msg, data); };

  if (body.event !== 'messages.upsert') {
    return res.status(200).json({ ignored: true, reason: 'event not messages.upsert' });
  }

  const data = body.data;
  const fromMe = data?.key?.fromMe === true;
  const remoteJid = data?.key?.remoteJidAlt || data?.key?.remoteJid || '';
  const isStatus = remoteJid === 'status@broadcast';
  const isGroup = remoteJid.endsWith('@g.us');

  // 1. Tenta identificar o cliente_id IMEDIATAMENTE para poder logar
  const pool = getPool();
  const prefixMatch = String(instance).match(/^cliente_(\d+)_/);
  if (prefixMatch) {
    cid = parseInt(prefixMatch[1]);
  } else {
    const map = await pool.query(
      'SELECT cliente_id FROM instancias_mapeamento WHERE instance_name = $1',
      [instance]
    );
    if (map.rows.length > 0) cid = map.rows[0].cliente_id;
  }

  // Log inicial de recebimento (ajuda a saber se a Evolution sequer bateu aqui)
  if (!isStatus && !fromMe) {
    log('filter', `Requisição recebida da instância: ${instance}`, {
      event: body.event,
      remoteJid,
      found_client: !!cid
    });
  }

  if (!remoteJid.endsWith('@s.whatsapp.net')) {
    if (!isStatus && !fromMe) log('filter', 'Ignorado: Não é chat individual', { remoteJid });
    return res.status(200).json({ ignored: true, reason: 'not individual chat' });
  }

  if (!data.message) {
    return res.status(200).json({ ignored: true, reason: 'no message content' });
  }

  if (!cid) {
    warn('auth', 'Instância não reconhecida ou não vinculada', { instance });
    return res.status(400).json({ error: 'Instância não reconhecida.' });
  }

  const telefone = remoteJid.split('@')[0];
  const cliente_id = cid;

  const clientRes = await pool.query(
    'SELECT token_meta, pixel_padrao, template_venda FROM clientes WHERE id = $1',
    [cliente_id]
  );
  const cliente = clientRes.rows[0] || {};
  const token = cliente.token_meta || process.env.META_ADS_TOKEN || null;
  const pixel = cliente.pixel_padrao || null;

  if (!fromMe) {
    const ctx = data.contextInfo || {};
    const adReply = ctx.externalAdReply || {};
    const ctwaClid = adReply.ctwaClid || null;

    if (!ctwaClid) {
      log('filter', 'Ignorado: Lead sem ID de anúncio (ctwaClid)', { telefone });
      return res.status(200).json({ ignored: true, reason: 'no ctwaClid' });
    }

    log('recv', 'Mensagem recebida de lead (CTWA)', { instance, telefone, pushName: data.pushName });

    const sourceId = adReply.sourceId || null;
    const event_source_url = adReply.sourceUrl || '';
    const anuncio_thumbnail_url = adReply.thumbnailUrl || '';
    const plataforma = ctx.entryPointConversionApp || (adReply.mediaType === 2 ? 'instagram' : 'facebook');
    const nome = normalizarNome(data.pushName);
    const mensagem_recebida = data.message?.conversation || data.message?.extendedTextMessage?.text || '';

    let utm_campaign = null, utm_medium = null, utm_content = null, page_id = null;

    if (sourceId && token) {
      try {
        const metaUrl = `https://graph.facebook.com/v20.0/${sourceId}?fields=name,adset{name},campaign{name},tracking_specs&access_token=${token}`;
        const metaRes = await fetch(metaUrl);
        const meta = await metaRes.json();
        utm_campaign = meta.campaign?.name || null;
        utm_medium = meta.adset?.name || null;
        utm_content = meta.name || null;
        const specs = Array.isArray(meta.tracking_specs) ? meta.tracking_specs : [];
        for (const spec of specs) {
          if (spec.page?.length > 0) { page_id = String(spec.page[0]); break; }
        }
      } catch (e) {
        warn('meta-api', 'Erro ao buscar dados do anúncio', { error: e.message });
      }
    }

    // FASE 2: Parser e Scoring
    const flags = getMessageFlags(mensagem_recebida);
    const initialScore = calculateLeadScore(flags, null);

    const insertResult = await pool.query(`
      INSERT INTO leads_tracking (
        cliente_id, nome, telefone, mensagem_recebida, ctw_aci_id, source_id,
        event_source_url, anuncio_thumbnail_url, instancia, status, event_time,
        utm_campaign, utm_medium, utm_content, page_id, plataforma, pixel,
        lead_score, created_at, last_interaction_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'novo',to_timestamp($10),$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
      RETURNING *
    `, [
      cliente_id, nome, telefone, mensagem_recebida,
      ctwaClid, sourceId || '',
      event_source_url, anuncio_thumbnail_url,
      instance, Math.floor(Date.now() / 1000),
      utm_campaign, utm_medium, utm_content, page_id, plataforma, pixel,
      initialScore
    ]);

    const lead = insertResult.rows[0];
    await sendCapiLead(lead, pixel, token, log, warn);

    return res.status(200).json({ success: true, message: 'Lead salvo', lead_id: lead.id });
  }

  if (fromMe) {
    const msg = data.message?.conversation || data.message?.extendedTextMessage?.text || data.message?.imageMessage?.caption || data.message?.documentMessage?.caption || '';

    const templateRaw = cliente.template_venda || null;
    const fieldMap = templateRaw
      ? parseTemplate(templateRaw)
      : { valor: 'Valor', nome: 'Nome', cidade: 'Cidade', estado: 'Estado', produto: 'Produto', endereco: 'Endereço' };

    const extract = (field) => {
      const label = fieldMap[field];
      if (!label) return null;
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = msg.match(new RegExp(`${escaped}[:\\s]+([^\\n]+)`, 'i'));
      return m ? m[1].trim() : null;
    };

    const valorRaw = extract('valor') || '0';
    const valor = parseFloat(valorRaw.replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;

    if (valor <= 0) {
      // Se não for uma venda, apenas atualiza a última interação do lead
      await pool.query(
        'UPDATE leads_tracking SET last_interaction_at = NOW(), first_response_at = COALESCE(first_response_at, NOW()) WHERE telefone = $1 AND cliente_id = $2',
        [telefone, cliente_id]
      );
      return res.status(200).json({ ignored: true, reason: 'not a sale message' });
    }

    log('sale', 'Venda detectada via template', { instance, telefone, valor });

    const nome = extract('nome');
    const cidadeRaw = extract('cidade');
    const cidadeF = cidadeRaw?.includes(' - ') ? cidadeRaw.split(' - ')[0].trim() : cidadeRaw;
    const estado = extract('estado') || (cidadeRaw?.includes(' - ') ? cidadeRaw.split(' - ')[1].trim() : null);
    const produto = extract('produto');
    const endereco = extract('endereco');
    const cor = extract('cor');
    const forma_pagamento = extract('pagamento') || extract('forma_pagamento');
    const cpf = extract('cpf');
    const email = extract('email');

    const leadQuery = await pool.query(
      'SELECT * FROM leads_tracking WHERE telefone = $1 AND cliente_id = $2 ORDER BY id DESC LIMIT 1',
      [telefone, cliente_id]
    );

    if (leadQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const updateResult = await pool.query(`
      UPDATE leads_tracking
      SET status = 'venda_fechada', valor_venda = $1,
          cidade          = COALESCE($2, cidade),
          estado          = COALESCE($3, estado),
          nome            = COALESCE($4, nome),
          produto         = COALESCE($5, produto),
          endereco        = COALESCE($6, endereco),
          cor             = COALESCE($7, cor),
          forma_pagamento = COALESCE($8, forma_pagamento),
          cpf             = COALESCE($9, cpf),
          email           = COALESCE($10, email),
          sale_closed_at  = NOW(),
          last_interaction_at = NOW(),
          first_response_at = COALESCE(first_response_at, NOW()),
          lead_score      = 100
      WHERE id = $11 RETURNING *
    `, [valor, cidadeF || null, estado || null, nome || null,
      produto || null, endereco || null, cor || null,
      forma_pagamento || null, cpf || null, email || null, leadQuery.rows[0].id]);

    const leadAtualizado = updateResult.rows[0];
    await sendCapiPurchase(leadAtualizado, pixel, token, log, warn);

    return res.status(200).json({ success: true, message: 'Venda registrada', lead_id: leadAtualizado.id });
  }
}

// ─── CAPI helpers ────────────────────────────────────────────────────────────

const hash = str =>
  /^[a-f0-9]{64}$/.test(str)
    ? str
    : crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');

async function sendCapiLead(lead, pixel, token, log, warn) {
  if (!pixel || !token || !lead.ctw_aci_id) return;
  const ph = (lead.telefone || '').replace(/\D/g, '');
  const userData = { ctwa_clid: lead.ctw_aci_id };
  if (ph) userData.ph = hash(ph);
  if (lead.page_id) userData.page_id = lead.page_id;

  const payload = {
    data: [{
      event_name: 'LeadSubmitted',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: userData,
    }]
  };

  try {
    const r = await fetch(`https://graph.facebook.com/v25.0/${pixel}/events?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const resp = await r.json();
    if (resp.events_received) log('capi-lead', '✅ CAPI Lead aceita');
  } catch (e) { warn('capi-lead', 'Erro CAPI', { error: e.message }); }
}

async function sendCapiPurchase(lead, pixel, token, log, warn) {
  if (!pixel || !token) return;
  const ph = (lead.telefone || '').replace(/\D/g, '');
  const nomeParts = (lead.nome || '').trim().split(/\s+/);
  const userData = { ctwa_clid: lead.ctw_aci_id || undefined };
  if (ph) userData.ph = hash(ph);
  if (nomeParts[0]) userData.fn = hash(nomeParts[0]);
  if (nomeParts[1]) userData.ln = hash(nomeParts.slice(1).join(' '));
  if (lead.estado) userData.st = hash(lead.estado);
  if (lead.cidade) userData.ct = hash(lead.cidade);
  if (lead.email) userData.em = hash(lead.email.toLowerCase().trim());
  if (lead.cpf) userData.external_id = hash(lead.cpf.replace(/\D/g, ''));
  if (lead.page_id) userData.page_id = lead.page_id;
  userData.country = hash('br');

  const customData = { currency: 'BRL', value: parseFloat(lead.valor_venda || 0) };
  if (lead.produto) customData.content_name = lead.produto;

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: userData,
      custom_data: customData
    }]
  };

  try {
    const r = await fetch(`https://graph.facebook.com/v25.0/${pixel}/events?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const resp = await r.json();
    if (resp.events_received) log('capi-purchase', '✅ CAPI Purchase aceita');
  } catch (e) { warn('capi-purchase', 'Erro CAPI', { error: e.message }); }
}
