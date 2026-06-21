import { getPool } from './_db.js';
import crypto from 'crypto';
import { cors } from './_cors.js';
import { decryptToken } from './_crypto.js';
import { decodeToken } from './_invisible-token.js';
import { ensureTrackingSchema } from './_tracking-schema.js';
import { enviarCapiWebLead } from './_capi-web.js';
import { enviarConversao, extrairValor } from './_capi.js';
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

            // ── Jornada de conversões: gatilho por palavra-chave do comercial ──
            // Best-effort e isolado: qualquer falha aqui NUNCA derruba o webhook.
            // Usa SOMENTE variáveis locais (clienteIdFm/telefoneFm) — 'instance'
            // não existe neste escopo (roda antes da declaração principal).
            try {
              const textoFm = (
                message.conversation ||
                message.extendedTextMessage?.text ||
                message.imageMessage?.caption ||
                message.videoMessage?.caption ||
                message.documentMessage?.caption ||
                message.buttonsResponseMessage?.selectedDisplayText ||
                message.listResponseMessage?.title || ''
              );
              if (textoFm.trim()) {
                await processarJornadaFromMe(pool, { clienteIdFm, telefoneFm, textoFm });
              }
            } catch (e) {
              log('warn', 'webhook_evo_journey_fail', { error: e.message });
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
  const mensagem_bruta =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    '';

  // ── 6b. Decodificar token invisível (link rastreável, Fase 2) ──
  // Extrai o tracking_id (se houver) e limpa o bloco invisível da mensagem.
  // A mensagem salva/exibida é a versão limpa.
  const { trackingId: clickTrackingId, cleanMessage: mensagem_recebida } = decodeToken(mensagem_bruta);

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

  try {
    await ensureTrackingSchema();
  } catch (e) {
    log('error', 'webhook_evo_tracking_schema_fail', { error: e.message });
    return res.status(500).json({ error: 'Falha ao preparar estrutura de captação.' });
  }

  // ── 10. Classificação de origem (captura configurável + link rastreável) ──
  // Default: ctwa_only (preserva comportamento histórico). Captura orgânica
  // só ocorre se a instância tiver config explícita 'all' ou 'keyword'.
  // Exceção: lead com token de link rastreável (clickTrackingId) é SEMPRE
  // capturado — mas somente depois de validar o token pendente no banco.
  let lead_origin = 'ctwa';
  let tracking_method = null;
  let captureCfg = null;
  let trackedClick = null;
  let effectiveTrackingId = clickTrackingId;
  if (!ctwaClid) {
    if (clickTrackingId) {
      try {
        const tokenRes = await getPool().query(
          `SELECT k.id, k.tracking_id, k.campaign_id, c.origin_type,
                  COALESCE(k.instance_name, d.instance_name) AS instance_name
           FROM tracking_clicks k
           JOIN tracking_campaigns c ON c.id = k.campaign_id
           LEFT JOIN tracking_destinations d ON d.id = k.destination_id
           WHERE k.tracking_id=$1 AND k.cliente_id=$2
             AND COALESCE(k.instance_name, d.instance_name)=$3
             AND k.status='clicked' AND k.converted_at IS NULL
             AND (k.expires_at IS NULL OR k.expires_at > NOW())
           LIMIT 1`,
          [clickTrackingId, cliente_id, instance]
        );
        trackedClick = tokenRes.rows[0] || null;
        if (!trackedClick) {
          await gravarLogWebhook({
            cliente_id, instance, tag: 'tracking_token',
            level: 'warn',
            message: 'Token recebido, mas sem clique pendente compatível com a instância.',
            data: { telefone, tracking_id: clickTrackingId }
          });
        }
      } catch (e) {
        log('warn', 'webhook_evo_tracking_token_lookup_fail', { error: e.message });
      }
    }

    // SEM fallback por tempo: a atribuição ao anúncio só acontece com CERTEZA —
    // token invisível validado (acima) ou CTWA nativo (ctwaClid). A correlação por
    // "clique recente" foi REMOVIDA porque casava mensagens orgânicas com cliques de
    // anúncio de outra pessoa só por coincidência de tempo (o clique não guarda o
    // telefone de quem clicou → era um chute, gerava atribuição errada).
    // Lead sem token/ctwaClid segue PURAMENTE a Captura Orgânica configurada pelo
    // usuário (capture_mode abaixo); nada de atribuição inventada por trás.

    if (trackedClick) {
      const origemMap = { bio: 'bio', rotator: 'rotator', campaign: 'campaign_link' };
      lead_origin = origemMap[trackedClick.origin_type] || 'campaign_link';
      tracking_method = tracking_method || 'token';
    } else {
      try {
        const poolCfg = getPool();
        const cfgRes = await poolCfg.query(
          'SELECT * FROM lead_capture_settings WHERE cliente_id = $1 AND instance_name = $2',
          [cliente_id, instance]
        );
        captureCfg = cfgRes.rows[0] || null;
      } catch (e) {
        log('warn', 'webhook_evo_capture_cfg_fail', { instance, error: e.message });
      }

      const modo = (captureCfg && captureCfg.enabled !== false) ? captureCfg.capture_mode : 'ctwa_only';
      if (modo === 'all') {
        lead_origin = 'organic';
      } else if (modo === 'keyword' && mensagemBateKeyword(mensagem_recebida, captureCfg)) {
        lead_origin = 'organic';
      } else {
        // ctwa_only (ou keyword sem match): mantém o filtro de só-anúncio.
        await gravarLogWebhook({
          cliente_id, instance, tag: 'tracking_ignored',
          level: 'info',
          message: 'Mensagem sem token válido e fora do modo de captura.',
          data: {
            telefone,
            capture_mode: modo,
            token_detectado: !!clickTrackingId
          }
        });
        return res.status(200).json({
          ignored: true,
          reason: 'Contato sem ctwaClid e fora do modo de captura — ignorado.'
        });
      }
    }
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

    // ── 12/13. Deduplicação + INSERT + atribuição em uma transação ──
    let lead = null;
    let atr = null;
    const writeClient = await pool.connect();
    try {
      await writeClient.query('BEGIN');
      // Para link rastreável o lock é por TELEFONE (não por tracking_id): assim
      // 2 toques simultâneos do mesmo número são serializados e não criam 2 leads.
      const dedupKey = trackedClick
        ? `tracking:${cliente_id}:${telefone}`
        : lead_origin === 'ctwa'
          ? `ctwa:${cliente_id}:${telefone}:${ctwaClid || ''}`
          : `organic:${cliente_id}:${instance}:${telefone}`;
      await writeClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [dedupKey]);

      // ── Link rastreável: CONTATO ÚNICO + FIRST-TOUCH ──
      // O mesmo telefone clicando de novo NÃO vira um lead novo. Procuramos o lead
      // existente do número; se houver, apenas registramos o novo toque (converte o
      // clique e aponta lead_id) sem sobrescrever a campanha/origem do lead (a do
      // PRIMEIRO contato permanece). O clique entra na jornada via tracking_clicks.
      if (trackedClick) {
        const existRes = await writeClient.query(
          `SELECT id, tracking_click_id FROM leads_tracking
           WHERE telefone = $1 AND cliente_id = $2
           ORDER BY created_at ASC LIMIT 1`,
          [telefone, cliente_id]
        );
        if (existRes.rows.length > 0) {
          // Lead já existe → novo toque na jornada, sem novo lead (first-touch).
          lead = existRes.rows[0];
          const jaTinhaAtribuicao = !!lead.tracking_click_id;
          atr = await atribuirClique(writeClient, {
            cliente_id, lead_id: lead.id, clickTrackingId: effectiveTrackingId,
            tracking_method, lead_origin, instance,
            // Se o lead JÁ tem clique principal, não sobrescrever sua origem/UTMs.
            preservarLead: jaTinhaAtribuicao
          });
          if (!atr) {
            await writeClient.query('ROLLBACK');
            return res.status(200).json({
              ignored: true,
              reason: 'Clique rastreável já convertido ou expirado.'
            });
          }
          // Marca o toque mais recente (a coluna já existe em leads_tracking).
          await writeClient.query(
            'UPDATE leads_tracking SET last_interaction_at = NOW() WHERE id = $1',
            [lead.id]
          );
          await writeClient.query('COMMIT');
          return res.status(200).json({
            ok: true,
            interaction: true,
            reason: 'Novo toque registrado na jornada do lead existente.',
            lead_id: lead.id,
            click_id: atr.click_id
          });
        }
        // Sem lead do telefone → segue para o INSERT normal (lead novo).
      }

      let dupeCheck;
      if (lead_origin === 'ctwa') {
        dupeCheck = await writeClient.query(
          `SELECT id FROM leads_tracking
           WHERE telefone = $1 AND ctw_aci_id = $2 AND cliente_id = $3
           AND event_time > NOW() - INTERVAL '24 hours'
           LIMIT 1`,
          [telefone, ctwaClid, cliente_id]
        );
      } else if (trackedClick) {
        dupeCheck = { rows: [] };
      } else {
        const dedupHoras = parseInt(captureCfg?.deduplication_hours, 10) || 24;
        dupeCheck = await writeClient.query(
          `SELECT id FROM leads_tracking
           WHERE telefone = $1 AND cliente_id = $2 AND instancia = $3
           AND event_time > NOW() - ($4 || ' hours')::interval
           LIMIT 1`,
          [telefone, cliente_id, instance, String(dedupHoras)]
        );
      }

      if (dupeCheck.rows.length > 0) {
        await writeClient.query('ROLLBACK');
        return res.status(200).json({
          ignored: true,
          reason: `Lead duplicado (${lead_origin}).`,
          existing_id: dupeCheck.rows[0].id
        });
      }

      const insertResult = await writeClient.query(`
        INSERT INTO leads_tracking (
          cliente_id, nome, telefone, mensagem_recebida, ctw_aci_id, source_id,
          event_source_url, anuncio_thumbnail_url, instancia, status, event_time,
          page_id, plataforma, utm_campaign, utm_medium, utm_content, lead_origin
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Lead', NOW(), $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [
        cliente_id, pushName || '', telefone, mensagem_recebida, ctwaClid, sourceId,
        event_source_url, anuncio_thumbnail_url, instance, page_id, plataforma,
        utm_campaign, utm_medium, utm_content, lead_origin
      ]);
      lead = insertResult.rows[0];

      if (trackedClick) {
        atr = await atribuirClique(writeClient, {
          cliente_id, lead_id: lead.id, clickTrackingId: effectiveTrackingId,
          tracking_method, lead_origin, instance
        });
        if (!atr) {
          await writeClient.query('ROLLBACK');
          return res.status(200).json({
            ignored: true,
            reason: 'Clique rastreável já convertido ou expirado.'
          });
        }
        lead.tracking_click_id = atr.click_id;
        lead.tracking_method = atr.method;
        lead.tracking_campaign_id = atr.campaign_id;
        lead.lead_origin = lead_origin;
      }

      await writeClient.query('COMMIT');
    } catch (e) {
      try { await writeClient.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      writeClient.release();
    }

    // CAPI Web roda depois do COMMIT; falha externa nunca deixa o banco parcial.
    if (atr?.fbc) {
      try {
        const capi = await enviarCapiWebLead(pool, {
          cliente_id, lead,
          click: {
            fbc: atr.fbc, fbp: atr.fbp, ip_address: atr.ip_address,
            user_agent: atr.user_agent, referrer: atr.referrer,
            event_source_url: atr.event_source_url,
            utm_campaign: atr.utm_campaign,
          }
        });
        await pool.query(
          `UPDATE tracking_clicks SET capi_web_status=$1 WHERE id=$2`,
          [capi.sent ? 'sent' : 'failed', atr.click_id]
        );
        await gravarLogWebhook({
          cliente_id, instance,
          tag: 'capi_web', level: capi.sent ? 'info' : 'warn',
          message: capi.sent ? 'CAPI Web Lead enviado (atribuído à campanha FB).'
                             : `CAPI Web Lead falhou: ${capi.error}`,
          data: { lead_id: lead.id, click_id: atr.click_id, fbtrace_id: capi.fbtrace_id, error: capi.error }
        });
      } catch (e) {
        log('warn', 'webhook_evo_capi_web_fail', { error: e.message });
      }
    }

    // ── 14. Gravar log no webhook_logs ──
    try {
      await pool.query(
        `INSERT INTO webhook_logs (cliente_id, instance, tag, level, message, data)
         VALUES ($1, $2, 'lead', 'info', $3, $4)`,
        [
          cliente_id,
          instance,
          `Lead salvo: ${pushName || telefone} (${lead_origin})`,
          JSON.stringify({ lead_id: lead.id, telefone, ctwaClid, plataforma, lead_origin })
        ]
      );
    } catch (_) { /* log best-effort */ }

    // ── 15. Disparar CAPI Lead — APENAS para origem CTWA ──
    // Leads orgânicos entram no banco mas nunca vão para a Meta.
    if (lead_origin === 'ctwa' && lead.ctw_aci_id) {
      await sendCapiLead(lead, pool);
    }

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

async function gravarLogWebhook({ cliente_id, instance, tag, level, message, data }) {
  try {
    await getPool().query(
      `INSERT INTO webhook_logs (cliente_id, instance, tag, level, message, data)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [cliente_id, instance, tag, level, message, JSON.stringify(data || {})]
    );
  } catch {
    // Diagnóstico best-effort: nunca interrompe o processamento do webhook.
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

// Normaliza texto p/ comparação de palavra-chave: minúsculas, sem acento, sem
// espaços extras. Usado na captura por keyword (modo configurável da instância).
function normalizarTexto(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/\s+/g, ' ')
    .trim();
}

// Verifica se a mensagem casa com as keywords da config (exact | partial).
function mensagemBateKeyword(mensagem, cfg) {
  if (!cfg || !Array.isArray(cfg.keywords) || !cfg.keywords.length) return false;
  const msg = normalizarTexto(mensagem);
  if (!msg) return false;
  const exact = cfg.keyword_match === 'exact';
  return cfg.keywords.some(k => {
    const kw = normalizarTexto(k);
    if (!kw) return false;
    return exact ? msg === kw : msg.includes(kw);
  });
}

// ── Jornada de conversões: avança a etapa a partir de uma mensagem do comercial ──
// Acionada no bloco fromMe. Carrega as etapas configuradas do cliente, identifica
// qual etapa a palavra-chave dispara, localiza o lead do telefone, aplica a regra
// "sequencial permitindo pular" (marca anteriores pendentes como concluídas SEM
// reenviar) e envia o evento à Meta via módulo central. Cada (lead, etapa) dispara
// 1x — a UNIQUE em lead_journey_history protege contra duplicado (ex: bot repetindo).
async function processarJornadaFromMe(pool, { clienteIdFm, telefoneFm, textoFm }) {
  // Etapas keyword ativas do cliente, em ordem do funil.
  const stagesRes = await pool.query(
    `SELECT id, name, event_concept, keywords, keyword_match, value_regex, currency, position
     FROM journey_stages
     WHERE cliente_id = $1 AND enabled = true AND trigger_type = 'keyword'
     ORDER BY position ASC, id ASC`,
    [clienteIdFm]
  );
  if (!stagesRes.rows.length) return;

  // Qual etapa a mensagem aciona (primeira que casar).
  const alvo = stagesRes.rows.find(s => mensagemBateKeyword(textoFm, s));
  if (!alvo) return;

  // Lead mais recente do telefone (padrão já usado no fromMe).
  const leadRes = await pool.query(
    `SELECT * FROM leads_tracking
     WHERE telefone = $1 AND cliente_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [telefoneFm, clienteIdFm]
  );
  const lead = leadRes.rows[0];
  if (!lead) return;

  // Já existe histórico dessa etapa para esse lead? (idempotência app-level)
  const jaRes = await pool.query(
    'SELECT 1 FROM lead_journey_history WHERE lead_id = $1 AND stage_id = $2 LIMIT 1',
    [lead.id, alvo.id]
  );
  if (jaRes.rows.length) return; // etapa já disparada — não repete (bot/mensagem repetida)

  // Sequencial permitindo pular: etapas ANTERIORES (position menor) ainda sem
  // histórico viram 'skipped' (concluídas sem reenviar evento à Meta).
  const anteriores = stagesRes.rows.filter(s => (s.position ?? 0) < (alvo.position ?? 0));
  for (const ant of anteriores) {
    await pool.query(
      `INSERT INTO lead_journey_history (lead_id, cliente_id, stage_id, event_concept, meta_status, created_at)
       VALUES ($1,$2,$3,$4,'skipped',NOW())
       ON CONFLICT (lead_id, stage_id) DO NOTHING`,
      [lead.id, clienteIdFm, ant.id, ant.event_concept]
    );
  }

  // Valor (se a etapa tem regex). Se exigir valor e não extrair → erro, não envia.
  let value = null;
  const exigeValor = alvo.event_concept === 'purchase' || alvo.event_concept === 'checkout';
  if (alvo.value_regex) value = extrairValor(textoFm, alvo.value_regex);
  if (exigeValor && alvo.value_regex && value == null) {
    await pool.query(
      `INSERT INTO lead_journey_history
        (lead_id, cliente_id, stage_id, event_concept, trigger_message, channel, meta_status, meta_response, created_at, last_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,'error','Valor não extraído da mensagem',NOW(),NOW())
       ON CONFLICT (lead_id, stage_id) DO NOTHING`,
      [lead.id, clienteIdFm, alvo.id, alvo.event_concept, textoFm.slice(0, 500), resolverCanalLocal(lead)]
    );
    log('warn', 'webhook_evo_journey_valor', { lead_id: lead.id, stage: alvo.name });
    return;
  }

  // Envia à Meta (canal decidido pelo módulo central) e registra o resultado.
  const r = await enviarConversao({
    lead, concept: alvo.event_concept, value, currency: alvo.currency || 'BRL', pool,
  });

  await pool.query(
    `INSERT INTO lead_journey_history
      (lead_id, cliente_id, stage_id, event_concept, event_name, trigger_message, value, currency,
       channel, event_id, meta_status, meta_response, fbtrace_id, attempts, created_at, last_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,NOW(),NOW())
     ON CONFLICT (lead_id, stage_id) DO UPDATE
       SET meta_status = EXCLUDED.meta_status, meta_response = EXCLUDED.meta_response,
           fbtrace_id = EXCLUDED.fbtrace_id, attempts = lead_journey_history.attempts + 1,
           last_attempt_at = NOW()`,
    [lead.id, clienteIdFm, alvo.id, alvo.event_concept, r.event_name, textoFm.slice(0, 500),
     value, alvo.currency || 'BRL', r.channel, r.event_id,
     r.sent ? 'sent' : 'error', r.sent ? null : (r.error || 'falha'), r.fbtrace_id || null]
  );

  // Atualiza a etapa atual do lead (e scheduled_at p/ agendamento).
  await pool.query(
    `UPDATE leads_tracking
     SET current_stage_id = $1, stage_changed_at = NOW()
         ${alvo.event_concept === 'appointment' ? ', scheduled_at = NOW()' : ''}
         ${alvo.event_concept === 'qualified' ? ', qualified_at = COALESCE(qualified_at, NOW())' : ''}
         ${alvo.event_concept === 'purchase' ? ", sale_closed_at = COALESCE(sale_closed_at, NOW()), status = 'Vendido'" : ''}
     WHERE id = $2`,
    [alvo.id, lead.id]
  );

  log('info', 'webhook_evo_journey', { lead_id: lead.id, stage: alvo.name, concept: alvo.event_concept, sent: r.sent });
}

// Canal local (espelha resolverCanal do _capi.js) só para o registro de erro
// quando nem chegamos a chamar enviarConversao (valor ausente).
function resolverCanalLocal(lead) {
  return lead.ctw_aci_id ? 'business_messaging' : 'website';
}

// Atribui um lead a um clique de link rastreável pelo token exato.
// Um clique só converte para UM lead (guard: status='clicked' AND converted_at IS NULL).
// Atribui o clique rastreável ao lead de forma ATÔMICA: grava os DOIS lados do
// vínculo (clique→lead e lead→clique) na MESMA transação. Recebe um `client`
// dedicado (BEGIN/COMMIT é responsabilidade do chamador), nunca o pool — assim,
// ou os dois lados persistem, ou nenhum. Antes isto eram dois UPDATEs autocommit
// soltos: o do clique gravava e o do lead falhava silenciosamente, deixando o
// lead com lead_origin='campaign_link' mas tracking_click_id NULL (lead órfão).
// `preservarLead`: quando true, o lead JÁ existe e tem atribuição de origem
// (first-touch num toque repetido). Aí só convertemos o clique + gravamos lead_id
// nele, SEM tocar nas UTMs/origem do lead — o clique vive em tracking_clicks e
// aparece na jornada, mas a campanha do PRIMEIRO contato permanece no lead.
async function atribuirClique(client, { cliente_id, lead_id, clickTrackingId, tracking_method, lead_origin, instance, preservarLead = false }) {
  if (!clickTrackingId) return null;
  const r = await client.query(
    `UPDATE tracking_clicks k
     SET status='converted', converted_at=NOW(), lead_id=$1
     WHERE tracking_id=$2 AND cliente_id=$3
       AND COALESCE(k.instance_name, (
         SELECT d.instance_name FROM tracking_destinations d WHERE d.id=k.destination_id
       ))=$4
       AND status='clicked' AND converted_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     RETURNING id, campaign_id, utm_source, utm_campaign, utm_medium, utm_content,
               fbc, fbp, ip_address, user_agent, referrer, event_source_url`,
    [lead_id, clickTrackingId, cliente_id, instance]
  );
  if (!r.rows.length) return null;
  const c = r.rows[0];
  const method = tracking_method || 'token';
  // Lado do lead — na MESMA transação do UPDATE do clique acima. Pulado quando
  // preservarLead (toque repetido): a origem do primeiro contato é mantida.
  if (!preservarLead) {
    await client.query(
      `UPDATE leads_tracking
       SET tracking_click_id = $1, tracking_campaign_id = $2,
           tracking_method = $3, lead_origin = $4,
           utm_source = COALESCE(utm_source, $5),
           utm_campaign = COALESCE(utm_campaign, $6),
           utm_medium = COALESCE(utm_medium, $7),
           utm_content = COALESCE(utm_content, $8)
       WHERE id = $9`,
      [c.id, c.campaign_id, method, lead_origin,
       c.utm_source, c.utm_campaign, c.utm_medium, c.utm_content, lead_id]
    );
  }
  return { click_id: c.id, campaign_id: c.campaign_id, method,
           utm_source: c.utm_source, utm_campaign: c.utm_campaign,
           utm_medium: c.utm_medium, utm_content: c.utm_content,
           fbc: c.fbc, fbp: c.fbp, ip_address: c.ip_address,
           user_agent: c.user_agent, referrer: c.referrer,
           event_source_url: c.event_source_url };
}

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
