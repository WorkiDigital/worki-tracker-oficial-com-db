import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';
import { requirePermission } from './_require-permission.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (requirePermission(user, res, 'leads')) return;
  if (await rateLimit(req, res, user)) return; // verifyAuth já envia os headers de erro 401.

  try {
    const pool = getPool();
    const requestedClient = req.query.cliente_id;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    // Sem teto de produto: o período (start/end) define o volume. O limite é só uma
    // guarda de segurança alta contra acidente, não um corte que esconde dados.
    const limit = Math.min(50000, Math.max(1, parseInt(req.query.limit || '50000', 10)));
    const offset = (page - 1) * limit;
    const { start, end } = req.query;

    try {
        // Monta WHERE dinâmico: escopo de cliente + janela de datas (start/end vindos do front).
        const where = [];
        const params = [];
        let i = 1;

        if (user.is_admin) {
            if (requestedClient) { where.push(`l.cliente_id = $${i++}`); params.push(requestedClient); }
        } else {
            where.push(`l.cliente_id = $${i++}`); params.push(user.cliente_id);
        }
        if (start) { where.push(`l.created_at >= $${i++}`); params.push(start); }
        if (end)   { where.push(`l.created_at <  $${i++}`); params.push(end); }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        params.push(limit); const limitIdx = i++;
        params.push(offset); const offsetIdx = i++;

        // Colunas explícitas (evita SELECT * que puxava TEXT pesados como
        // event_source_url/anuncio_thumbnail_url). Inclui o que tabela, gráficos e CSV usam.
        // last_interaction_at: usado pelo filtro client-side "Leads Esquecidos"
        // (mesmo critério de +48h do card em metrics-temporal.js).
        const COLS = `l.id, l.nome, l.telefone, l.status, l.plataforma, l.instancia, l.event_time,
            l.created_at, l.utm_campaign, l.utm_medium, l.utm_content, l.mensagem_recebida, l.valor_venda,
            l.qualified_at, l.email, l.cpf, l.endereco, l.cidade, l.estado, l.produto,
            l.ctw_aci_id, l.cliente_id, l.lead_origin, l.utm_source, l.last_interaction_at,
            l.tracking_click_id, l.tracking_campaign_id, l.tracking_method,
            tc.name AS tracking_campaign_name`;

        const result = await pool.query(
            `SELECT ${COLS}
             FROM leads_tracking l
             LEFT JOIN tracking_campaigns tc ON tc.id = l.tracking_campaign_id
             ${whereSql}
             ORDER BY l.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            params
        );
        return res.status(200).json(result.rows);
    } catch (dbError) {
        console.warn('DB Error, returning Mock Data:', dbError.message);
        // Compatibilidade de deploy: o código pode subir antes de setup-db.js criar
        // as colunas/tabelas da Fase 2. Nesse intervalo, mantém a listagem principal
        // funcionando sem os campos de tracking.
        if (dbError.code === '42P01' || dbError.code === '42703') {
            try {
                const legacyCols = `l.id, l.nome, l.telefone, l.status, l.plataforma, l.instancia, l.event_time,
                    l.created_at, l.utm_campaign, l.utm_medium, l.utm_content, l.mensagem_recebida, l.valor_venda,
                    l.qualified_at, l.email, l.cpf, l.endereco, l.cidade, l.estado, l.produto,
                    l.ctw_aci_id, l.cliente_id, l.lead_origin, l.utm_source`;
                const fallback = await pool.query(
                    `SELECT ${legacyCols}
                     FROM leads_tracking l
                     ${whereSql}
                     ORDER BY l.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
                    params
                );
                return res.status(200).json(fallback.rows);
            } catch (fallbackError) {
                console.warn('Leads fallback error:', fallbackError.message);
                if (process.env.NODE_ENV === 'production') throw fallbackError;
            }
        }
        if (process.env.NODE_ENV === 'production') {
            throw dbError;
        }
        // --- DADOS DE TESTE (MOCK) ---
        return res.status(200).json([
            { id: 1, nome: 'João Silva', telefone: '11999999999', status: 'lead', instancia: 'WhatsApp Empresa', plataforma: 'whatsapp', event_time: new Date().toISOString(), utm_content: 'Anuncio_01' },
            { id: 2, nome: 'Maria Oliveira', telefone: '21988888888', status: 'vendido', instancia: 'Suporte Vendas', plataforma: 'instagram', event_time: new Date().toISOString(), utm_content: 'Influencer_X' },
            { id: 3, nome: 'Carlos Souza', telefone: '31977777777', status: 'lead', instancia: 'WhatsApp Empresa', plataforma: 'facebook', event_time: new Date().toISOString(), utm_content: 'Anuncio_02' },
            { id: 4, nome: 'Ana Costa', telefone: '11966666666', status: 'vendido', instancia: 'WhatsApp Empresa', plataforma: 'whatsapp', event_time: new Date().toISOString(), utm_content: 'GoogleAds_01' },
            { id: 5, nome: 'Pedro Rocha', telefone: '41955555555', status: 'pendente', instancia: 'Setor Financeiro', plataforma: 'whatsapp', event_time: new Date().toISOString(), utm_content: 'Direto' }
        ]);
    }
  } catch (error) {
    console.error('Leads GET error:', error);
    if (error.code === '42P01') {
        return res.status(200).json([]); // Retorna array vazio se a tabela ainda não existir
    }
    return res.status(500).json({ error: error.message || 'Erro ao buscar leads.' });
  }
}
