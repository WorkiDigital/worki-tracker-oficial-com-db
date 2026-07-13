import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';
import { ensureChatMessagesSchema } from './_chat-schema.js';

function parseClienteId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function addScopedClient(where, params, user, requestedClient) {
  if (user.is_admin) {
    const scopedClient = parseClienteId(requestedClient);
    if (scopedClient) {
      params.push(scopedClient);
      where.push(`m.cliente_id = $${params.length}`);
    }
    return;
  }
  params.push(user.cliente_id);
  where.push(`m.cliente_id = $${params.length}`);
}
function addInstanceFilter(where, params, instance) {
  if (!instance) return;
  params.push(instance);
  where.push(`m.instance = $${params.length}`);
}
function addOrigemFilter(havingWhere, params, origem) {
  if (!origem) return;
  params.push(origem);
  havingWhere.push(`lead.lead_origin = $${params.length}`);
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const action = req.query?.action || req.body?.action || 'list_conversations';
  const pool = getPool();

  try {
    await ensureChatMessagesSchema();

    if (action === 'list_clients') {
      const where = [`m.message_at >= NOW() - INTERVAL '15 days'`];
      const params = [];
      if (!user.is_admin) {
        params.push(user.cliente_id);
        where.push(`m.cliente_id = $${params.length}`);
      }

      const result = await pool.query(`
        SELECT
          m.cliente_id AS id,
          COALESCE(NULLIF(cli.nome, ''), cli.email_contato, m.cliente_id::text) AS nome,
          COUNT(*)::int AS message_count,
          MAX(m.message_at) AS last_message_at
        FROM public.chat_messages m
        LEFT JOIN public.clientes cli ON cli.id = m.cliente_id
        WHERE ${where.join(' AND ')}
        GROUP BY m.cliente_id, cli.nome, cli.email_contato
        ORDER BY MAX(m.message_at) DESC, nome ASC
      `, params);

      return res.status(200).json(result.rows);
    }
    if (action === 'list_conversations') {
      const where = [`m.message_at >= NOW() - INTERVAL '15 days'`];
      const params = [];
      addScopedClient(where, params, user, req.query.cliente_id);
      addInstanceFilter(where, params, req.query.instance);
      const origemWhere = [];
      addOrigemFilter(origemWhere, params, req.query.origem);

      const search = String(req.query.search || '').trim();
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const searchParam = search ? `%${search}%` : null;
      if (searchParam) params.push(searchParam);
      const searchIdx = searchParam ? params.length : null;

      const result = await pool.query(`
        WITH scoped AS (
          SELECT m.*
          FROM public.chat_messages m
          ${whereSql}
        ),
        last_msg AS (
          SELECT DISTINCT ON (cliente_id, instance, telefone)
            id, cliente_id, lead_id, instance, telefone, push_name, from_me,
            body, message_type, media_url, message_at
          FROM scoped
          ORDER BY cliente_id, instance, telefone, message_at DESC, id DESC
        ),
        -- Nome do CONTATO: pega o push_name da ultima mensagem que veio DELE
        -- (from_me=false, nao vazio) — nunca da empresa. Sem isso, se a ultima
        -- mensagem da conversa fosse uma resposta da propria empresa, a lista
        -- mostrava o nome do negocio no lugar do cliente.
        contact_name AS (
          SELECT DISTINCT ON (cliente_id, instance, telefone)
            cliente_id, instance, telefone, push_name AS contact_push_name
          FROM scoped
          WHERE from_me = false AND push_name IS NOT NULL AND push_name <> ''
          ORDER BY cliente_id, instance, telefone, message_at DESC, id DESC
        ),
        counts AS (
          SELECT cliente_id, instance, telefone, COUNT(*)::int AS message_count
          FROM scoped
          GROUP BY cliente_id, instance, telefone
        )
        SELECT
          lm.id, lm.cliente_id, lm.lead_id, lm.instance, lm.telefone, lm.from_me,
          lm.body, lm.message_type, lm.media_url, lm.message_at,
          COALESCE(cn.contact_push_name, lm.push_name) AS push_name,
          c.message_count,
          cli.nome AS cliente_nome,
          lead.id AS lead_id,
          lead.nome AS lead_nome,
          lead.status AS lead_status,
          lead.lead_origin,
          lead.utm_campaign,
          lead.utm_medium,
          lead.utm_content
        FROM last_msg lm
        JOIN counts c
          ON c.cliente_id = lm.cliente_id
         AND c.instance = lm.instance
         AND c.telefone = lm.telefone
        LEFT JOIN contact_name cn
          ON cn.cliente_id = lm.cliente_id
         AND cn.instance = lm.instance
         AND cn.telefone = lm.telefone
        LEFT JOIN public.clientes cli ON cli.id = lm.cliente_id
        LEFT JOIN LATERAL (
          SELECT id, nome, status, lead_origin, utm_campaign, utm_medium, utm_content
          FROM public.leads_tracking l
          WHERE l.cliente_id = lm.cliente_id
            AND l.telefone = lm.telefone
          ORDER BY l.created_at DESC NULLS LAST, l.id DESC
          LIMIT 1
        ) lead ON true
        WHERE TRUE
          ${origemWhere.length ? `AND ${origemWhere.join(' AND ')}` : ''}
          ${searchParam ? `AND (lm.telefone ILIKE $${searchIdx}
           OR lm.push_name ILIKE $${searchIdx}
           OR lead.nome ILIKE $${searchIdx})` : ''}
        ORDER BY lm.message_at DESC, lm.id DESC
        LIMIT 200
      `, params);

      return res.status(200).json(result.rows);
    }

    if (action === 'get_messages') {
      const telefone = String(req.query.telefone || '').replace(/\D/g, '');
      const instance = String(req.query.instance || '').trim();
      if (!telefone) return res.status(400).json({ error: 'telefone obrigatorio' });
      if (!instance) return res.status(400).json({ error: 'instance obrigatoria' });

      const where = [
        `m.message_at >= NOW() - INTERVAL '15 days'`,
        `m.telefone = $1`,
        `m.instance = $2`
      ];
      const params = [telefone, instance];
      addScopedClient(where, params, user, req.query.cliente_id);

      const result = await pool.query(`
        SELECT
          m.id, m.cliente_id, m.lead_id, m.instance, m.telefone, m.remote_jid,
          m.push_name, m.from_me, m.message_id, m.body, m.message_type,
          m.media_url, m.message_at, m.created_at
        FROM public.chat_messages m
        WHERE ${where.join(' AND ')}
        ORDER BY m.message_at ASC, m.id ASC
        LIMIT 1000
      `, params);

      return res.status(200).json(result.rows);
    }

    if (action === 'get_media') {
      const id = parseClienteId(req.query.id);
      if (!id) return res.status(400).json({ error: 'id obrigatorio' });

      const where = [`m.id = $1`];
      const params = [id];
      addScopedClient(where, params, user, req.query.cliente_id);

      const result = await pool.query(`
        SELECT m.id, m.cliente_id, m.instance, m.message_id, m.message_type, m.media_url
        FROM public.chat_messages m
        WHERE ${where.join(' AND ')}
        LIMIT 1
      `, params);

      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Mensagem nao encontrada' });
      if (!row.message_id) return res.status(404).json({ error: 'Midia sem message_id' });

      const EVO_URL = process.env.EVOLUTION_API_URL;
      const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
      if (!EVO_URL || !EVO_KEY) {
        return res.status(500).json({ error: 'Configuracao da Evolution API ausente no servidor.' });
      }

      try {
        const evoRes = await fetch(`${EVO_URL}/chat/getBase64FromMediaMessage/${encodeURIComponent(row.instance)}`, {
          method: 'POST',
          headers: { 'apikey': EVO_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { key: { id: row.message_id } }, convertToMp4: false })
        });
        if (!evoRes.ok) {
          const text = await evoRes.text().catch(() => '');
          return res.status(502).json({ error: `Evolution API respondeu ${evoRes.status}: ${text.slice(0, 200)}` });
        }
        const data = await evoRes.json();
        const base64 = data.base64 || data.data?.base64;
        if (!base64) return res.status(502).json({ error: 'Evolution API nao retornou midia' });
        const mimetype = data.mimetype || data.data?.mimetype || (
          row.message_type === 'audio' ? 'audio/ogg' :
          row.message_type === 'image' ? 'image/jpeg' :
          row.message_type === 'video' ? 'video/mp4' : 'application/octet-stream'
        );
        return res.status(200).json({ dataUrl: `data:${mimetype};base64,${base64}` });
      } catch (evoError) {
        console.error('[chat-messages] get_media', evoError);
        return res.status(502).json({ error: 'Falha ao buscar midia na Evolution API' });
      }
    }

    if (action === 'get_lead') {
      const telefone = String(req.query.telefone || '').replace(/\D/g, '');
      if (!telefone) return res.status(400).json({ error: 'telefone obrigatorio' });

      const params = [telefone];
      const where = [`l.telefone = $1`];
      const scopedClient = parseClienteId(req.query.cliente_id);
      if (user.is_admin && scopedClient) {
        params.push(scopedClient);
        where.push(`l.cliente_id = $${params.length}`);
      } else if (!user.is_admin) {
        params.push(user.cliente_id);
        where.push(`l.cliente_id = $${params.length}`);
      }

      const result = await pool.query(`
        SELECT
          l.id, l.cliente_id, l.nome, l.telefone, l.status, l.plataforma,
          l.instancia, l.created_at, l.event_time, l.first_response_at,
          l.sale_closed_at, l.qualified_at, l.utm_campaign, l.utm_medium,
          l.utm_content, l.utm_source, l.source_id, l.mensagem_recebida,
          l.valor_venda, l.lead_score, l.email, l.cpf, l.endereco,
          l.cidade, l.estado, l.produto, l.lead_origin,
          l.tracking_click_id, l.tracking_campaign_id, l.tracking_method,
          tc.name AS tracking_campaign_name
        FROM public.leads_tracking l
        LEFT JOIN public.tracking_campaigns tc ON tc.id = l.tracking_campaign_id
        WHERE ${where.join(' AND ')}
        ORDER BY l.created_at DESC NULLS LAST, l.id DESC
        LIMIT 1
      `, params);

      if (!result.rows.length) return res.status(200).json({ lead: null });
      return res.status(200).json({ lead: result.rows[0] });
    }

    if (action === 'send_message') {
      const instance = String(req.body?.instance || '').trim();
      const telefone = String(req.body?.telefone || '').replace(/\D/g, '');
      const messageType = String(req.body?.message_type || 'text').trim();
      if (!instance) return res.status(400).json({ error: 'instance obrigatoria' });
      if (!telefone) return res.status(400).json({ error: 'telefone obrigatorio' });

      // Escopo do cliente: mesma regra de addScopedClient, mas cliente_id vem do body em POST.
      const clienteId = user.is_admin
        ? (parseClienteId(req.body?.cliente_id) || null)
        : user.cliente_id;
      if (!clienteId) return res.status(400).json({ error: 'cliente_id obrigatorio' });

      // Validacao de escopo da INSTANCIA (padrao mais rigoroso do projeto, ver
      // api/evo-groups.js): cliente comum so pode usar instancia com seu prefixo
      // OU vinculada a ele em instancias_mapeamento.
      if (!user.is_admin) {
        const prefix = `cliente_${user.cliente_id}_`;
        if (!instance.startsWith(prefix)) {
          const linked = await pool.query(
            'SELECT id FROM instancias_mapeamento WHERE instance_name = $1 AND cliente_id = $2',
            [instance, user.cliente_id]
          );
          if (linked.rowCount === 0) {
            return res.status(403).json({ error: 'Acesso negado a esta instancia.' });
          }
        }
      }

      const EVO_URL = process.env.EVOLUTION_API_URL;
      const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
      if (!EVO_URL || !EVO_KEY) {
        return res.status(500).json({ error: 'Configuracao da Evolution API ausente no servidor.' });
      }
      const evoHeaders = { 'apikey': EVO_KEY, 'Content-Type': 'application/json' };
      const number = telefone;

      let evoUrl, evoBody;
      const caption = req.body?.caption ? String(req.body.caption).trim().slice(0, 4096) : undefined;

      if (messageType === 'text') {
        const text = String(req.body?.text || '').trim();
        if (!text) return res.status(400).json({ error: 'text obrigatorio' });
        evoUrl = `${EVO_URL}/message/sendText/${encodeURIComponent(instance)}`;
        evoBody = { number, text };
      } else {
        const base64 = String(req.body?.media_base64 || '');
        if (!base64) return res.status(400).json({ error: 'media_base64 obrigatorio' });
        const mimeType = String(req.body?.mime_type || '').trim();
        const fileName = String(req.body?.file_name || '').trim().slice(0, 255) || 'arquivo';

        if (messageType === 'audio' && (req.body?.audio_mode || 'file') === 'ptt') {
          // Nota de voz: endpoint dedicado da Evolution, sem mediatype/fileName.
          evoUrl = `${EVO_URL}/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`;
          evoBody = { number, audio: base64 };
        } else {
          const mediatype = ['image', 'video', 'audio', 'document'].includes(messageType)
            ? messageType : 'document';
          evoUrl = `${EVO_URL}/message/sendMedia/${encodeURIComponent(instance)}`;
          evoBody = { number, mediatype, media: base64, fileName, mimetype: mimeType || undefined };
          if (caption) evoBody.caption = caption;
        }
      }

      let evoData;
      try {
        const evoRes = await fetch(evoUrl, { method: 'POST', headers: evoHeaders, body: JSON.stringify(evoBody) });
        if (!evoRes.ok) {
          const text = await evoRes.text().catch(() => '');
          return res.status(502).json({ error: `Evolution API respondeu ${evoRes.status}: ${text.slice(0, 200)}` });
        }
        evoData = await evoRes.json();
      } catch (evoError) {
        console.error('[chat-messages] send_message', evoError);
        return res.status(502).json({ error: 'Falha ao enviar mensagem via Evolution API' });
      }

      // Evolution retorna key.id da mensagem criada — usar como message_id para
      // deduplicar com o eco que o webhook eventualmente vai gravar via
      // salvarChatMessageBestEffort (ON CONFLICT (instance, message_id)). O shape
      // de resposta varia por endpoint/versao da Evolution (sendText/sendMedia/
      // sendWhatsAppAudio) — tenta todos os caminhos conhecidos antes de desistir.
      const messageId = evoData?.key?.id
        || evoData?.message?.key?.id
        || evoData?.data?.key?.id
        || evoData?.messageId
        || null;
      if (!messageId) {
        console.warn('[chat-messages] send_message: Evolution nao retornou message_id', {
          instance, messageType, evoBodyKeys: Object.keys(evoData || {})
        });
      }
      const body = messageType === 'text' ? req.body.text : (caption || null);

      const leadRes = await pool.query(
        `SELECT id FROM leads_tracking WHERE cliente_id = $1 AND telefone = $2
         ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1`,
        [clienteId, telefone]
      );
      const leadId = leadRes.rows[0]?.id || null;

      const insertRes = await pool.query(`
        INSERT INTO public.chat_messages
          (cliente_id, lead_id, instance, telefone, from_me, message_id, body, message_type, media_url, message_at)
        VALUES ($1,$2,$3,$4,true,$5,$6,$7,NULL,NOW())
        ON CONFLICT (instance, message_id) WHERE message_id IS NOT NULL
        DO UPDATE SET body = COALESCE(EXCLUDED.body, public.chat_messages.body)
        RETURNING id, cliente_id, lead_id, instance, telefone, remote_jid, push_name,
                  from_me, message_id, body, message_type, media_url, message_at, created_at
      `, [clienteId, leadId, instance, telefone, messageId, body, messageType]);

      return res.status(200).json({ message: insertRes.rows[0] });
    }

    return res.status(400).json({ error: 'action invalida' });
  } catch (error) {
    console.error('[chat-messages]', error);
    return res.status(500).json({ error: error.message || 'Erro ao carregar conversas.' });
  }
}
