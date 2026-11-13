// Ferramentas do MCP de leitura. SOMENTE LEITURA, consultas fixas e parametrizadas (sem SQL livre).
// Nunca devolver: tokens, senhas, chaves da Evolution, IP do clique, conteúdo de mensagens,
// nome/telefone/e-mail de leads. v1 só trabalha com dados agregados.
import { getPool } from './_db.js';
import { intervaloMeta, metaAdsDoCliente, metaAdsConsolidado } from './_mcp-ads.js';
import { calcularParaLead } from './engagement-metrics.js';
import { getEngagementSettings } from './_engagement-schema.js';
import { ensureChatMessagesSchema } from './_chat-schema.js';

const TZ = 'America/Sao_Paulo';
const MAX_DIAS = 90;
const MAX_LINHAS = 200;
const ORIGENS = new Set(['ctwa', 'campaign_link', 'organic', 'bio', 'rotator', 'intelligent']);
const ORIGEM_LABEL = {
  ctwa: 'Anúncio CTWA', campaign_link: 'Link rastreável', organic: 'Orgânico',
  bio: 'Link da bio', rotator: 'Rotador', intelligent: 'Rastr. inteligente',
};

const AVISOS_BASE = [
  'Status de lead tem grafias misturadas no banco; os números aqui já comparam em minúsculas.',
  'Vendas são contadas por sale_closed_at (quando fecharam); leads por created_at (quando entraram). Em ciclos longos, vendas podem exceder leads do mesmo período.',
];

const DICIONARIO = `# Dicionário de métricas — Adlytics Pro

- **Lead**: contato registrado em leads_tracking. Conta por data de entrada (created_at).
- **Venda**: lead com sale_closed_at preenchido. Conta por data de fechamento, NÃO de entrada.
- **Qualificado**: lead com qualified_at preenchido.
- **Origem (lead_origin)**: mecanismo de captura — ctwa, campaign_link, bio, rotator, organic, intelligent. Não é a plataforma de anúncio.
- **Plataforma**: Meta (ctwa, plataforma facebook/instagram ou utm_source fb/ig), Google (plataforma google ou utm_source google/adwords), Outras (origem rastreada que não é Meta nem Google), Não rastreadas (sem origem ou orgânico).
- **Status**: grafias misturadas (novo, lead, Lead, Pendente, Vendido, Qualificado...). Sempre comparar em minúsculas.
- **Atribuição de link**: só acontece com token invisível ou CTWA. Sem isso o lead não recebe campanha — atribuição ausente é proposital.
- **Tempo de resposta**: first_response_at inclui respostas de bot/saudação automática; pode subestimar o tempo humano.
- **Chat**: mensagens ficam apenas 15 dias.
- **Moeda**: valores de venda em BRL. Fuso: America/Sao_Paulo.
`;

export const RESOURCES = [
  {
    uri: 'adlytics://dicionario-de-metricas',
    name: 'Dicionário de métricas',
    description: 'Definições e armadilhas das métricas do Adlytics Pro. Leia antes de interpretar números.',
    mimeType: 'text/markdown',
    text: DICIONARIO,
  },
];

function periodoParams(raw) {
  const v = String(raw ?? '30').trim();
  if (v === 'hoje' || v === 'ontem') return { tipo: v, label: v };
  const n = Number.parseInt(v, 10);
  const dias = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_DIAS) : 30;
  return { tipo: 'dias', dias, label: `ultimos_${dias}_dias` };
}

// Retorna condição SQL para a coluna de data; `idx` é o próximo índice de parâmetro livre.
function periodoSql(column, p, idx) {
  const base = `date_trunc('day', NOW() AT TIME ZONE '${TZ}')`;
  if (p.tipo === 'hoje') {
    return { sql: `${column} >= (${base} AT TIME ZONE '${TZ}') AND ${column} < ((${base} + INTERVAL '1 day') AT TIME ZONE '${TZ}')`, params: [] };
  }
  if (p.tipo === 'ontem') {
    return { sql: `${column} >= ((${base} - INTERVAL '1 day') AT TIME ZONE '${TZ}') AND ${column} < (${base} AT TIME ZONE '${TZ}')`, params: [] };
  }
  return { sql: `${column} > NOW() - INTERVAL '1 day' * $${idx}`, params: [p.dias] };
}

function parseClienteId(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error('cliente_id inválido.');
  return n;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

const ARGS_COMUNS = {
  periodo: {
    type: 'string',
    description: `Período: "hoje", "ontem" ou número de dias (1 a ${MAX_DIAS}). Padrão: 30.`,
  },
  cliente_id: {
    type: 'integer',
    description: 'ID do cliente (use listar_clientes). Omitido = consolidado de todos os clientes.',
  },
};

export const TOOLS = [
  {
    name: 'listar_clientes',
    description: 'Lista os clientes ativos da agência (ID, nome e conta de anúncios Meta). Use os IDs nas demais ferramentas.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const r = await getPool().query(
        `SELECT id, nome, account_id FROM clientes WHERE archived_at IS NULL ORDER BY nome ASC LIMIT ${MAX_LINHAS}`
      );
      return { total: r.rows.length, clientes: r.rows };
    },
  },

  {
    name: 'performance_anuncios',
    description: 'Meta Ads: lista campanhas (ou conjuntos) com gasto, impressões, alcance, cliques no link, CTR, CPC, resultados e custo por resultado. "Resultados" segue a meta de conversão de cada conjunto (leads, conversas, contatos, compras...), igual ao Gerenciador da Meta. Com cliente_id lista as campanhas daquele cliente; sem cliente_id devolve só o total de cada cliente (pode levar alguns segundos). Por padrão mostra só o que teve gasto no período.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ARGS_COMUNS,
        nivel: { type: 'string', enum: ['campanha', 'conjunto'], description: 'Nível da lista (só com cliente_id). Padrão: campanha.' },
        apenas_ativas: { type: 'boolean', description: 'true = só campanhas/conjuntos ativos agora. Padrão: false (inclui pausados que gastaram no período).' },
        incluir_sem_gasto: { type: 'boolean', description: 'true = inclui itens sem gasto no período. Padrão: false.' },
      },
      additionalProperties: false,
    },
    async run({ periodo, cliente_id, nivel, apenas_ativas, incluir_sem_gasto }) {
      const intervalo = intervaloMeta(periodo);
      const cid = parseClienteId(cliente_id);
      const opcoes = {
        nivel: nivel === 'conjunto' ? 'conjunto' : 'campanha',
        somenteAtivas: apenas_ativas === true,
        incluirSemGasto: incluir_sem_gasto === true,
        limite: MAX_LINHAS,
      };
      const base = { periodo: intervalo.label, de: intervalo.since, ate: intervalo.until };

      if (!cid) {
        const d = await metaAdsConsolidado(intervalo, opcoes);
        return { ...base, ...d, dica: 'Passe cliente_id para listar as campanhas de um cliente.' };
      }
      const r = await getPool().query(
        'SELECT id, nome, account_id FROM clientes WHERE id = $1 AND archived_at IS NULL',
        [cid]
      );
      if (!r.rows.length) throw new Error('cliente_id inválido: cliente não encontrado.');
      try {
        const d = await metaAdsDoCliente(r.rows[0], intervalo, opcoes);
        return { ...base, ...d };
      } catch (e) {
        // Mensagens de configuração/Meta (nossas, sem credenciais) são repassadas para a IA explicar.
        return { ...base, cliente_id: cid, erro: String(e.message || 'Falha ao consultar a Meta.').slice(0, 200) };
      }
    },
  },

  {
    name: 'visao_geral',
    description: 'Resumo do período: leads novos, qualificados, vendas, receita e conversão. Sem cliente_id, devolve o total da agência e a quebra por cliente. Não inclui gasto de anúncios (use performance_anuncios).',
    inputSchema: { type: 'object', properties: { ...ARGS_COMUNS }, additionalProperties: false },
    async run({ periodo, cliente_id }) {
      const p = periodoParams(periodo);
      const cid = parseClienteId(cliente_id);
      const pool = getPool();

      const params = [];
      let idx = 1;
      let cli = '';
      if (cid) { cli = `AND l.cliente_id = $${idx++}`; params.push(cid); }
      const perCreated = periodoSql('l.created_at', p, idx);
      const perSale = periodoSql('l.sale_closed_at', p, idx);
      const periodoParam = perCreated.params; // mesmo valor para os dois (índice idx)
      const allParams = [...params, ...periodoParam];

      const leadsQ = await pool.query(
        `SELECT l.cliente_id,
                COUNT(*)::int AS leads,
                COUNT(l.qualified_at)::int AS qualificados
         FROM leads_tracking l
         WHERE ${perCreated.sql} ${cli}
         GROUP BY l.cliente_id`,
        allParams
      );
      const vendasQ = await pool.query(
        `SELECT l.cliente_id,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(l.valor_venda), 0) AS receita
         FROM leads_tracking l
         WHERE ${perSale.sql} ${cli}
         GROUP BY l.cliente_id`,
        allParams
      );

      const nomes = await pool.query('SELECT id, nome FROM clientes');
      const nomePor = new Map(nomes.rows.map(r => [r.id, r.nome]));

      const mapa = new Map();
      const get = (id) => {
        if (!mapa.has(id)) mapa.set(id, { cliente_id: id, cliente: nomePor.get(id) || null, leads: 0, qualificados: 0, vendas: 0, receita: 0 });
        return mapa.get(id);
      };
      leadsQ.rows.forEach(r => { const o = get(r.cliente_id); o.leads = r.leads; o.qualificados = r.qualificados; });
      vendasQ.rows.forEach(r => { const o = get(r.cliente_id); o.vendas = r.vendas; o.receita = num(r.receita); });

      const linhas = [...mapa.values()];
      const total = linhas.reduce((t, o) => ({
        leads: t.leads + o.leads,
        qualificados: t.qualificados + o.qualificados,
        vendas: t.vendas + o.vendas,
        receita: t.receita + o.receita,
      }), { leads: 0, qualificados: 0, vendas: 0, receita: 0 });
      total.ticket_medio = total.vendas ? Number((total.receita / total.vendas).toFixed(2)) : null;
      total.vendas_sobre_leads_pct = total.leads ? Number((total.vendas / total.leads * 100).toFixed(1)) : null;

      linhas.sort((a, b) => b.leads - a.leads);
      return {
        periodo: p.label,
        total,
        por_cliente: cid ? undefined : linhas.slice(0, MAX_LINHAS),
        cliente: cid ? linhas[0] || { cliente_id: cid, cliente: nomePor.get(cid) || null, leads: 0, qualificados: 0, vendas: 0, receita: 0 } : undefined,
      };
    },
  },

  {
    name: 'funil_leads',
    description: 'Funil de leads do período: total, primeiro contato, qualificados, proposta, vendas, tempo médio de resposta e ciclo de venda; leads por status; e por plataforma (Meta, Google, outras, não rastreadas).',
    inputSchema: { type: 'object', properties: { ...ARGS_COMUNS }, additionalProperties: false },
    async run({ periodo, cliente_id }) {
      const p = periodoParams(periodo);
      const cid = parseClienteId(cliente_id);
      const pool = getPool();

      const params = [];
      let idx = 1;
      let cli = '';
      if (cid) { cli = `AND cliente_id = $${idx++}`; params.push(cid); }
      const perCreated = periodoSql('created_at', p, idx);
      const perSale = periodoSql('sale_closed_at', p, idx);
      const allParams = [...params, ...perCreated.params];

      const overview = await pool.query(
        `SELECT
           COUNT(*)::int AS total_leads,
           COUNT(*) FILTER (WHERE first_response_at IS NOT NULL OR LOWER(COALESCE(status,'')) NOT IN ('lead','novo',''))::int AS primeiro_contato,
           COUNT(qualified_at)::int AS qualificados,
           COUNT(proposal_sent_at)::int AS proposta_enviada,
           AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL) AS tempo_resposta_medio_min
         FROM leads_tracking
         WHERE ${perCreated.sql} ${cli}`,
        allParams
      );

      const vendas = await pool.query(
        `SELECT COUNT(*)::int AS vendas,
                COALESCE(SUM(valor_venda), 0) AS receita,
                AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) AS ciclo_medio_dias
         FROM leads_tracking
         WHERE ${perSale.sql} ${cli}`,
        allParams
      );

      const status = await pool.query(
        `SELECT LOWER(COALESCE(NULLIF(status,''),'sem_status')) AS status, COUNT(*)::int AS leads
         FROM leads_tracking
         WHERE ${perCreated.sql} ${cli}
         GROUP BY 1 ORDER BY 2 DESC LIMIT ${MAX_LINHAS}`,
        allParams
      );

      const plataforma = await pool.query(
        `SELECT
           COUNT(*) FILTER (
             WHERE lead_origin = 'ctwa'
                OR LOWER(COALESCE(plataforma,'')) IN ('facebook','instagram')
                OR (COALESCE(plataforma,'') = '' AND (LOWER(COALESCE(utm_source,'')) LIKE '%fb%' OR LOWER(COALESCE(utm_source,'')) LIKE '%face%' OR LOWER(COALESCE(utm_source,'')) LIKE '%ig%' OR LOWER(COALESCE(utm_source,'')) LIKE '%insta%'))
           )::int AS meta_ads,
           COUNT(*) FILTER (
             WHERE lead_origin != 'ctwa'
               AND (LOWER(COALESCE(plataforma,'')) = 'google'
                    OR (COALESCE(plataforma,'') = '' AND (LOWER(COALESCE(utm_source,'')) LIKE '%google%' OR LOWER(COALESCE(utm_source,'')) LIKE '%adwords%')))
           )::int AS google_ads,
           COUNT(*) FILTER (
             WHERE lead_origin != 'ctwa'
               AND lead_origin IS NOT NULL AND lead_origin != '' AND lead_origin != 'organic'
               AND LOWER(COALESCE(plataforma,'')) NOT IN ('facebook','instagram','google')
               AND NOT (COALESCE(plataforma,'') = '' AND (LOWER(COALESCE(utm_source,'')) LIKE '%fb%' OR LOWER(COALESCE(utm_source,'')) LIKE '%face%' OR LOWER(COALESCE(utm_source,'')) LIKE '%ig%' OR LOWER(COALESCE(utm_source,'')) LIKE '%insta%' OR LOWER(COALESCE(utm_source,'')) LIKE '%google%' OR LOWER(COALESCE(utm_source,'')) LIKE '%adwords%'))
           )::int AS outras_origens,
           COUNT(*) FILTER (WHERE lead_origin IS NULL OR lead_origin = '' OR lead_origin = 'organic')::int AS nao_rastreadas
         FROM leads_tracking
         WHERE ${perCreated.sql} ${cli}`,
        allParams
      );

      const o = overview.rows[0];
      const v = vendas.rows[0];
      return {
        periodo: p.label,
        cliente_id: cid,
        funil: {
          total_leads: o.total_leads,
          primeiro_contato: o.primeiro_contato,
          qualificados: o.qualificados,
          proposta_enviada: o.proposta_enviada,
          vendas: v.vendas,
          receita: num(v.receita),
          tempo_resposta_medio_min: o.tempo_resposta_medio_min === null ? null : Number(Number(o.tempo_resposta_medio_min).toFixed(1)),
          ciclo_medio_dias: v.ciclo_medio_dias === null ? null : Number(Number(v.ciclo_medio_dias).toFixed(1)),
        },
        leads_por_status: status.rows,
        leads_por_plataforma: plataforma.rows[0],
      };
    },
  },
  // ── Atendimento: os 5 cards do topo da tela de Leads ───────────────────────
  {
    name: 'metricas_atendimento',
    description: 'Os cards da tela de Leads: ciclo médio de venda, resposta média (minutos), leads esquecidos (sem contato há +48h), vendas rápidas (fechadas em menos de 24h) e índice de engajamento comercial (0-100). Sem cliente_id, calcula sobre todos os clientes.',
    inputSchema: { type: 'object', properties: { ...ARGS_COMUNS }, additionalProperties: false },
    async run({ periodo, cliente_id }) {
      const p = periodoParams(periodo);
      const cid = parseClienteId(cliente_id);
      const pool = getPool();

      const params = [];
      let idx = 1;
      let cli = '';
      if (cid) { cli = `AND cliente_id = $${idx++}`; params.push(cid); }
      const perCreated = periodoSql('created_at', p, idx);
      const perSale = periodoSql('sale_closed_at', p, idx);
      const allParams = [...params, ...perCreated.params];

      const leads = await pool.query(
        `SELECT
           COUNT(*)::int AS leads,
           AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL) AS resposta_media_min,
           COUNT(*) FILTER (
             WHERE last_interaction_at < NOW() - INTERVAL '48 hours'
               AND LOWER(COALESCE(status,'')) NOT IN ('venda_fechada','perdido','vendido','agendado')
           )::int AS leads_esquecidos
         FROM leads_tracking
         WHERE ${perCreated.sql} ${cli}`,
        allParams
      );
      const vendas = await pool.query(
        `SELECT
           COUNT(*)::int AS vendas,
           AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) AS ciclo_medio_dias,
           COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (sale_closed_at - created_at))/3600 < 24)::int AS vendas_rapidas
         FROM leads_tracking
         WHERE ${perSale.sql} ${cli}`,
        allParams
      );

      // Índice de engajamento: média do índice dos 200 leads mais recentes do período (mesma regra do painel).
      let engajamento = { indice_medio: null, amostra: 0 };
      try {
        await ensureChatMessagesSchema();
        const amostra = await pool.query(
          `SELECT id, cliente_id, telefone, instancia, created_at, first_response_at
           FROM leads_tracking
           WHERE ${perCreated.sql} ${cli}
           ORDER BY created_at DESC LIMIT 200`,
          allParams
        );
        const cache = {};
        const indices = [];
        for (const l of amostra.rows) {
          if (!cache[l.cliente_id]) cache[l.cliente_id] = await getEngagementSettings(l.cliente_id);
          const r = await calcularParaLead(pool, {
            cliente_id: l.cliente_id, telefone: l.telefone, instancia: l.instancia,
            created_at: l.created_at, first_response_at: l.first_response_at, settings: cache[l.cliente_id],
          });
          if (r.indice != null) indices.push(r.indice);
        }
        engajamento = {
          indice_medio: indices.length ? Math.round(indices.reduce((a, b) => a + b, 0) / indices.length) : null,
          amostra: indices.length,
          observacao: 'Média do índice (0-100) dos até 200 leads mais recentes do período. Tempo de resposta e volume de mensagens só existem nos últimos 15 dias de conversa.',
        };
      } catch (e) {
        engajamento = { indice_medio: null, amostra: 0, erro: 'Não foi possível calcular o engajamento agora.' };
      }

      const l = leads.rows[0];
      const v = vendas.rows[0];
      const dias = v.ciclo_medio_dias === null ? null : Number(v.ciclo_medio_dias);
      return {
        periodo: p.label,
        cliente_id: cid,
        leads_no_periodo: l.leads,
        ciclo_medio: dias === null ? null : { dias: Number(dias.toFixed(2)), horas: Number((dias * 24).toFixed(1)) },
        vendas_no_periodo: v.vendas,
        resposta_media_min: l.resposta_media_min === null ? null : Math.round(Number(l.resposta_media_min)),
        leads_esquecidos: l.leads_esquecidos,
        vendas_rapidas: { quantidade: v.vendas_rapidas, percentual_das_vendas: v.vendas ? Math.round(v.vendas_rapidas / v.vendas * 100) : 0 },
        engajamento,
      };
    },
  },

  // ── Lista de leads (DADOS PESSOAIS) — só para chaves com o escopo "dados pessoais" ──
  {
    name: 'listar_leads',
    requiresPii: true,
    description: 'Lista os leads como na tela de Leads: data, nome, telefone, status, anúncio, campanha, conjunto, origem, instância e plataforma. CONTÉM DADOS PESSOAIS. Mais recentes primeiro, com paginação e filtros.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ARGS_COMUNS,
        origem: { type: 'string', enum: ['ctwa', 'campaign_link', 'organic', 'bio', 'rotator', 'intelligent'], description: 'Filtra pela origem do lead.' },
        status: { type: 'string', description: 'Filtra pelo status (ex.: lead, qualificado, vendido). Sem diferenciar maiúsculas.' },
        busca: { type: 'string', description: 'Texto para buscar em nome, telefone, anúncio, campanha ou conjunto.' },
        limite: { type: 'integer', description: 'Leads por página (1 a 100). Padrão: 50.' },
        pagina: { type: 'integer', description: 'Página (começa em 1). Padrão: 1.' },
      },
      additionalProperties: false,
    },
    async run({ periodo, cliente_id, origem, status, busca, limite, pagina }) {
      const p = periodoParams(periodo);
      const cid = parseClienteId(cliente_id);
      const porPagina = Math.min(Math.max(Number.parseInt(limite, 10) || 50, 1), 100);
      const pag = Math.max(Number.parseInt(pagina, 10) || 1, 1);

      const where = [];
      const params = [];
      if (cid) { params.push(cid); where.push(`l.cliente_id = $${params.length}`); }
      if (p.tipo === 'dias') {
        params.push(p.dias);
        where.push(`l.created_at > NOW() - INTERVAL '1 day' * $${params.length}`);
      } else {
        where.push(periodoSql('l.created_at', p, 0).sql);
      }
      if (origem) {
        if (!ORIGENS.has(origem)) throw new Error('origem inválida.');
        if (origem === 'organic') where.push(`(l.lead_origin IS NULL OR l.lead_origin = '' OR l.lead_origin = 'organic')`);
        else { params.push(origem); where.push(`l.lead_origin = $${params.length}`); }
      }
      if (status) {
        params.push(String(status).trim().toLowerCase().slice(0, 40));
        where.push(`LOWER(COALESCE(l.status,'')) = $${params.length}`);
      }
      if (busca) {
        params.push(`%${String(busca).trim().slice(0, 80)}%`);
        const i = params.length;
        where.push(`(l.nome ILIKE $${i} OR l.telefone ILIKE $${i} OR l.utm_content ILIKE $${i} OR l.utm_campaign ILIKE $${i} OR l.utm_medium ILIKE $${i})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const pool = getPool();

      const total = await pool.query(`SELECT COUNT(*)::int AS n FROM leads_tracking l ${whereSql}`, params);
      const offset = (pag - 1) * porPagina;
      const r = await pool.query(
        `SELECT l.id, l.created_at, l.nome, l.telefone, l.status, l.plataforma, l.instancia,
                l.utm_campaign, l.utm_medium, l.utm_content, l.utm_source, l.lead_origin,
                l.cliente_id, c.nome AS cliente, tc.name AS link_nome
         FROM leads_tracking l
         LEFT JOIN clientes c ON c.id = l.cliente_id
         LEFT JOIN tracking_campaigns tc ON tc.id = l.tracking_campaign_id
         ${whereSql}
         ORDER BY l.created_at DESC
         LIMIT ${porPagina} OFFSET ${offset}`,
        params
      );

      const leads = r.rows.map(l => {
        const origemKey = l.lead_origin || 'organic';
        const semAnuncio = ['organic', 'bio'].includes(origemKey);
        const us = String(l.utm_source || '').toLowerCase();
        let plataforma = l.plataforma || null;
        if (!plataforma && ['campaign_link', 'bio', 'rotator'].includes(origemKey)) {
          if (us.includes('ig') || us.includes('insta')) plataforma = 'instagram';
          else if (us.includes('fb') || us.includes('face')) plataforma = 'facebook';
          else if (us.includes('google') || us.includes('adwords')) plataforma = 'google';
        }
        return {
          id: l.id,
          data: l.created_at,
          cliente_id: l.cliente_id,
          cliente: l.cliente,
          nome: l.nome,
          telefone: l.telefone,
          status: l.status,
          anuncio: l.utm_content || (semAnuncio ? 'Orgânico' : null),
          campanha: l.utm_campaign || l.link_nome || null,
          conjunto: l.utm_medium || null,
          origem: ORIGEM_LABEL[origemKey] || origemKey,
          instancia: l.instancia,
          plataforma,
        };
      });

      return {
        periodo: p.label,
        total: total.rows[0].n,
        pagina: pag,
        por_pagina: porPagina,
        total_paginas: Math.max(1, Math.ceil(total.rows[0].n / porPagina)),
        leads,
        aviso_privacidade: 'Esta resposta contém dados pessoais de leads (nome e telefone). Não compartilhe fora do contexto de análise.',
      };
    },
  },
];

export { AVISOS_BASE };
