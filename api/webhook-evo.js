import { getPool } from './_db.js';
import crypto from 'crypto';
import { cors } from './_cors.js';
import { decryptToken } from './_crypto.js';
import { log } from './_logger.js';

// ── Handler principal — recebe payload bruto da Evolution API ──
export default async function handler(req, res) {
  if (cors(req, res, ['POST'], { public: true })) return;

  // ── 1. Validação do Secret ──
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerSecret = req.headers['x-webhook-secret'];
    const querySecret = req.query?.secret;
    if (headerSecret !== webhookSecret && querySecret !== webhookSecret) {
      log('warn', 'webhook_evo_auth_fail', { header: !!headerSecret, query: !!querySecret });
      return res.status(401).json({ error: 'Webhook secret inválido.' });
    }
  }

  const body = req.body;

  // ── 2. Filtrar apenas MESSAGES_UPSERT ──
  const event = body.event || body.apiType || '';
  if (event && event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') {
    return res.status(200).json({ ignored: true, reason: `Evento ${event} ignorado.` });
  }

  // ── 3. Extrair dados da mensagem ──
  // A Evolution pode mandar em formatos diferentes dependendo da versão.
  // Formato v1: body.data.key, body.data.message, body.data.pushName
  // Formato v2: body.data[] como array
  // Formato legacy: body.key, body.message, body.pushName
  const msgData = body.data
    ? (Array.isArray(body.data) ? body.data[0] : body.data)
    : body;

  if (!msgData) {
    return res.status(200).json({ ignored: true, reason: 'Payload sem dados de mensagem.' });
  }

  const key = msgData.key || {};
  const message = msgData.message || {};
  const pushName = msgData.pushName || msgData.pushname || '';

  // ── 4. Mensagens enviadas pelo próprio número (fromMe) ──
  // Em vez de ignorar, aproveita para registrar a primeira resposta da empresa ao lead.
  if (key.fromMe === true) {
    const remoteJidFm = key.remoteJid || '';
    if (!remoteJidFm.includes('@g.us') && !remoteJidFm.includes('@broadcast')) {
      const telefoneFm = remoteJidFm.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
      if (telefoneFm) {
        try {
          const pool = getPool();
          // Extrai instância aqui pois ainda não foi declarada no escopo principal
          const instanceFm = body.instance || body.instanceName || body.sender?.instance || body.apiType || '';
          // Resolve cliente_id pela instância
          let clienteIdFm = null;
          const matchFm = String(instanceFm).match(/^cliente_(\d+)_/);
          if (matchFm) clienteIdFm = parseInt(matchFm[1]);
          if (!clienteIdFm && instanceFm) {
            const mapFm = await pool.query(
              'SELECT cliente_id FROM instancias_mapeamento WHERE instance_name = $1', [instanceFm]
            );
            if (mapFm.rows.length > 0) clienteIdFm = mapFm.rows[0].cliente_id;
          }
          if (clienteIdFm) {
            // Preenche first_response_at apenas no lead mais recente sem resposta
            const upd = await pool.query(`
              UPDATE leads_tracking
              SET first_response_at = NOW()
              WHERE id = (
                SELECT id FROM leads_tracking
                WHERE telefone = $1 AND cliente_id = $2 AND first_response_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
              )
              RETURNING id
            `, [telefoneFm, clienteIdFm]);
            if (upd.rows.length > 0) {
              log('info', 'webhook_evo_first_response', { lead_id: upd.rows[0].id, telefoneFm });
            }
          }
        } catch (e) {
          log('warn', 'webhook_evo_first_response_fail', { error: e.message });
        }
      }
    }
    return res.status(200).json({ ignored: true, reason: 'Mensagem enviada (fromMe) — first_response_at atualizado se aplicável.' });
  }

  // ── 5. Extrair telefone do remoteJid ──
  const remoteJid = key.remoteJid || '';
  // Ignora grupos (g.us) e broadcasts
  if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) {
    return res.status(200).json({ ignored: true, reason: 'Mensagem de grupo/broadcast ignorada.' });
  }
  const telefone = remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
  if (!telefone) {
    return res.status(200).json({ ignored: true, reason: 'Sem telefone válido.' });
  }

  // ── 6. Extrair texto da mensagem ──
  const mensagem_recebida =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    '';

  // ── 7. Extrair dados CTWA (Click-to-WhatsApp Ads) ──
  // A Evolution manda o contextInfo em locais diferentes conforme a versão.
  // Em algumas versões vem direto em body.data.contextInfo (msgData.contextInfo),
  // em outras dentro de message.* — por isso checamos todos.
  const contextInfo = msgData.contextInfo
    || message.contextInfo
    || message.extendedTextMessage?.contextInfo
    || message.imageMessage?.contextInfo
    || message.videoMessage?.contextInfo
    || {};

  const externalAdReply = contextInfo.externalAdReply || {};
  const ctwaContext = contextInfo.ctwaContext || {};

  // ctwaClid pode vir em vários locais dependendo da versão
  const ctwaClid =
    ctwaContext.ctwaClid ||
    externalAdReply.ctwaClid ||
    contextInfo.ctwaClid ||
    msgData.contextInfo?.externalAdReply?.ctwaClid ||
    null;

  const sourceId =
    ctwaContext.sourceId ||
    externalAdReply.sourceId ||
    '';

  const event_source_url =
    externalAdReply.sourceUrl ||
    ctwaContext.sourceUrl ||
    '';

  const anuncio_thumbnail_url =
    externalAdReply.thumbnailUrl ||
    externalAdReply.thumbnail ||
    '';

  // ── 8. Extrair nome da instância ──
  const instance =
    body.instance ||
    body.instanceName ||
    body.sender?.instance ||
    body.apiType ||
    '';

  // ── 9. Resolver cliente_id ──
  let cliente_id = null;

  // 9a. Tentar pelo prefixo da instância (ex: "cliente_7_Loja" → 7)
  if (instance) {
    const match = String(instance).match(/^cliente_(\d+)_/);
    if (match) cliente_id = parseInt(match[1]);
  }

  // 9b. Fallback: buscar na tabela de mapeamento
  if (!cliente_id && instance) {
    try {
      const pool = getPool();
      const map = await pool.query(
        'SELECT cliente_id FROM instancias_mapeamento WHERE instance_name = $1',
        [instance]
      );
      if (map.rows.length > 0) cliente_id = map.rows[0].cliente_id;
    } catch (e) {
      log('warn', 'webhook_evo_db_lookup_fail', { instance, error: e.message });
    }
  }

  if (!cliente_id) {
    log('warn', 'webhook_evo_no_client', { instance, telefone });
    return res.status(400).json({
      error: 'Instância não reconhecida. Vincule-a a um cliente no painel.',
      instance
    });
  }

  // ── 10. Filtro: só salvar leads de anúncio (com ctwaClid) ──
  if (!ctwaClid) {
    return res.status(200).json({
      ignored: true,
      reason: 'Contato sem ctwaClid — não veio de anúncio, ignorado.'
    });
  }

  // ── 11. Extrair metadados adicionais ──
  const plataforma = detectarPlataforma(event_source_url, externalAdReply);
  let page_id = extrairPageId(event_source_url);

  // Dados de campanha/anúncio a preencher via Graph API
  let utm_campaign = null, utm_medium = null, utm_content = null;

  try {
    const pool = getPool();

    // ── 11b. Busca page_id + campanha + conjunto + anúncio via Graph API ──
    // Feita sempre que tiver sourceId e token disponível — uma única chamada traz tudo.
    if (sourceId) {
      const cliRes = await pool.query('SELECT token_meta, token_meta_enc FROM clientes WHERE id = $1', [cliente_id]);
      const cli = cliRes.rows[0];
      let token = cli?.token_meta || null;
      if (cli?.token_meta_enc) {
        try { token = decryptToken(cli.token_meta_enc); } catch (e) { console.error('Webhook: erro descriptografia token', e.message); }
      }
      if (token) {
        const adInfo = await buscarInfoAnuncio(sourceId, token);
        if (adInfo) {
          if (!page_id) page_id = adInfo.page_id;
          utm_campaign = adInfo.campaign_name;
          utm_medium   = adInfo.adset_name;
          utm_content  = adInfo.ad_name;
          console.log(`[webhook-evo] ad info obtida: ${utm_campaign} / ${utm_medium} / ${utm_content}`);
        }
        // Loga sempre que page_id continuar NULL — mesmo que adInfo tenha vindo
        // com UTMs (anúncio sem object_story_spec.page_id acessível).
        if (!page_id) {
          const motivo = adInfo
            ? 'page_id NULL — anúncio sem object_story_spec.page_id'
            : 'page_id NULL — Graph API não retornou';
          try {
            await pool.query(
              `INSERT INTO webhook_logs (cliente_id, instance, tag, level, message, data)
               VALUES ($1, $2, 'page_id_missing', 'warn', $3, $4)`,
              [cliente_id, instance, `${motivo} (sourceId: ${sourceId})`,
               JSON.stringify({ sourceId, telefone, temUtm: !!(adInfo?.campaign_name) })]
            );
          } catch (_) {}
        }
      } else {
        // Sem token — loga causa exata na aba Logs do Sistema
        try {
          await pool.query(
            `INSERT INTO webhook_logs (cliente_id, instance, tag, level, message, data)
             VALUES ($1, $2, 'page_id_missing', 'warn', $3, $4)`,
            [cliente_id, instance, `page_id NULL — cliente sem token (sourceId: ${sourceId})`,
             JSON.stringify({ sourceId, telefone })]
          );
        } catch (_) {}
      }
    }

    // ── 12. Deduplicação — evitar leads duplicados nas últimas 24h ──
    const dupeCheck = await pool.query(
      `SELECT id FROM leads_tracking
       WHERE telefone = $1 AND ctw_aci_id = $2 AND cliente_id = $3
       AND event_time > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [telefone, ctwaClid, cliente_id]
    );
    if (dupeCheck.rows.length > 0) {
      return res.status(200).json({
        ignored: true,
        reason: 'Lead duplicado (mesmo telefone + ctwaClid nas últimas 24h).',
        existing_id: dupeCheck.rows[0].id
      });
    }

    // ── 13. INSERT do lead ──
    const insertResult = await pool.query(`
      INSERT INTO leads_tracking (
        cliente_id, nome, telefone, mensagem_recebida, ctw_aci_id, source_id,
        event_source_url, anuncio_thumbnail_url, instancia, status, event_time,
        page_id, plataforma, utm_campaign, utm_medium, utm_content
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Lead', NOW(), $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      cliente_id,
      pushName || '',
      telefone,
      mensagem_recebida,
      ctwaClid,
      sourceId,
      event_source_url,
      anuncio_thumbnail_url,
      instance,
      page_id,
      plataforma,
      utm_campaign,
      utm_medium,
      utm_content
    ]);

    const lead = insertResult.rows[0];

    // ── 14. Gravar log no webhook_logs ──
    try {
      await pool.query(
        `INSERT INTO webhook_logs (cliente_id, instance, tag, level, message, data)
         VALUES ($1, $2, 'lead', 'info', $3, $4)`,
        [
          cliente_id,
          instance,
          `Lead salvo: ${pushName || telefone} (CTWA)`,
          JSON.stringify({ lead_id: lead.id, telefone, ctwaClid, plataforma })
        ]
      );
    } catch (_) { /* log best-effort */ }

    // ── 15. Disparar CAPI Lead ──
    await sendCapiLead(lead, pool);

    log('info', 'webhook_evo_lead_saved', {
      lead_id: lead.id, cliente_id, telefone, instance, ctwaClid
    });

    return res.status(200).json({
      success: true,
      message: 'Lead salvo com sucesso (Evolution direto)',
      lead_id: lead.id
    });

  } catch (error) {
    log('error', 'webhook_evo_error', { error: error.message, instance, telefone });
    return res.status(500).json({ error: error.message });
  }
}

// ── CAPI Lead — dispara evento LeadSubmitted para a Meta ──
async function sendCapiLead(lead, pool) {
  let { pixel, ctw_aci_id, page_id, telefone, cliente_id } = lead;

  const clientRes = await pool.query(
    'SELECT pixel_padrao, token_meta, token_meta_enc FROM clientes WHERE id = $1',
    [cliente_id]
  );
  if (clientRes.rows.length > 0) {
    pixel = pixel || clientRes.rows[0].pixel_padrao;
  }
  const row = clientRes.rows[0];
  let token = row?.token_meta || process.env.META_ADS_TOKEN || null;
  if (row?.token_meta_enc) {
    try { token = decryptToken(row.token_meta_enc); }
    catch (e) { console.error('CAPI Lead (Evo): Erro ao descriptografar token', e.message); }
  }

  if (!pixel || !token || !ctw_aci_id) return;

  const hash = str => /^[a-f0-9]{64}$/.test(str)
    ? str
    : crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');

  const ph = (telefone || '').replace(/\D/g, '');

  const userData = {
    ctwa_clid: ctw_aci_id,
  };

  if (ph) userData.ph = [hash(ph)];
  if (page_id) userData.page_id = page_id;

  const payload = {
    data: [{
      event_name:        "LeadSubmitted",
      event_time:        Math.floor(Date.now() / 1000),
      action_source:     "business_messaging",
      messaging_channel: "whatsapp",
      user_data:         userData,
    }]
  };

  try {
    const r = await fetch(`https://graph.facebook.com/v25.0/${pixel}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const resp = await r.json();
    if (resp.events_received) {
      console.log('✅ CAPI Lead (Evo) aceita:', resp.fbtrace_id);
    } else {
      console.warn('❌ CAPI Lead (Evo) rejeitada:', resp.error || resp);
    }
  } catch (err) {
    console.error('CAPI Lead (Evo) error:', err.message || err);
  }
}

// ── Helpers ──

function detectarPlataforma(sourceUrl, adReply) {
  const url = (sourceUrl || '').toLowerCase();
  if (url.includes('instagram.com') || url.includes('instagram')) return 'instagram';
  if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook';
  const body = (adReply.body || '').toLowerCase();
  if (body.includes('instagram')) return 'instagram';
  if (body.includes('facebook')) return 'facebook';
  return null;
}

function extrairPageId(sourceUrl) {
  if (!sourceUrl) return null;
  // Tenta extrair page_id de URLs como https://www.facebook.com/1234567890/posts/...
  const match = sourceUrl.match(/facebook\.com\/(\d{10,})/);
  return match ? match[1] : null;
}

// Busca recursiva pela chave "page" em qualquer nível (usada em tracking_specs).
// Vários anúncios não expõem creative.object_story_spec.page_id (erro #100), mas
// trazem o page_id em tracking_specs[].page — método herdado do fluxo N8N.
function extrairPageDeTrackingSpecs(specs) {
  const pages = [];
  (function walk(o) {
    if (o && typeof o === 'object') {
      if (o.page) pages.push(...(Array.isArray(o.page) ? o.page : [o.page]));
      for (const k in o) if (typeof o[k] === 'object') walk(o[k]);
    }
  })(specs);
  return pages[0] || null;
}

// Busca page_id, campanha, conjunto e anúncio na Graph API a partir do sourceId.
// Uma única chamada retorna tudo — best-effort, não derruba o webhook em caso de falha.
// page_id: tenta object_story_spec; se vazio, cai no tracking_specs (cobre anúncios
// dynamic/catálogo que não têm story spec).
async function buscarInfoAnuncio(sourceId, token) {
  if (!sourceId || !token) return null;
  try {
    const fields = 'name,campaign_id,campaign{name},adset_id,adset{name},tracking_specs,creative{id,name,object_story_spec{page_id}}';
    const url = `https://graph.facebook.com/v25.0/${sourceId}?fields=${fields}&access_token=${token}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) {
      console.warn('[webhook-evo] buscarInfoAnuncio erro:', data.error.message);
      return null;
    }
    const page_id = data.creative?.object_story_spec?.page_id
      || extrairPageDeTrackingSpecs(data.tracking_specs)
      || null;
    return {
      page_id,
      campaign_name: data.campaign?.name  || null,
      adset_name:    data.adset?.name     || null,
      ad_name:       data.name            || null,
    };
  } catch (e) {
    console.warn('[webhook-evo] buscarInfoAnuncio falha:', e.message);
    return null;
  }
}
