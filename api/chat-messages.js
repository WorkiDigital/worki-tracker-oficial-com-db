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

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const action = req.query?.action || 'list_conversations';
  const pool = getPool();

  try {
    await ensureChatMessagesSchema();

    if (action === 'list_conversations') {
      const where = [`m.message_at >= NOW() - INTERVAL '15 days'`];
      const params = [];
      addScopedClient(where, params, user, req.query.cliente_id);
      addInstanceFilter(where, params, req.query.instance);

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
        counts AS (
          SELECT cliente_id, instance, telefone, COUNT(*)::int AS message_count
          FROM scoped
          GROUP BY cliente_id, instance, telefone
        )
        SELECT
          lm.*,
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
        LEFT JOIN public.clientes cli ON cli.id = lm.cliente_id
        LEFT JOIN LATERAL (
          SELECT id, nome, status, lead_origin, utm_campaign, utm_medium, utm_content
          FROM public.leads_tracking l
          WHERE l.cliente_id = lm.cliente_id
            AND l.telefone = lm.telefone
          ORDER BY l.created_at DESC NULLS LAST, l.id DESC
          LIMIT 1
        ) lead ON true
        ${searchParam ? `WHERE lm.telefone ILIKE $${searchIdx}
           OR lm.push_name ILIKE $${searchIdx}
           OR lead.nome ILIKE $${searchIdx}` : ''}
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

    return res.status(400).json({ error: 'action invalida' });
  } catch (error) {
    console.error('[chat-messages]', error);
    return res.status(500).json({ error: error.message || 'Erro ao carregar conversas.' });
  }
}
