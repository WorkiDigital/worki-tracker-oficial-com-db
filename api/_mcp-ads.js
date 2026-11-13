// Busca de dados do Meta Ads para o MCP (somente leitura). Nunca devolve token nem credenciais.
import { getPool } from './_db.js';
import { getTokenForUser } from './_auth.js';
import { fetchMeta } from './_meta-client.js';
import { normalizeAccountId } from './_validate.js';
import { resultadoDoConjunto, somarPorTipo } from './_ads-results.js';

const TZ = 'America/Sao_Paulo';
const GRAPH = 'https://graph.facebook.com/v23.0';
const MAX_PAGES = 10;

function hojeSP() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}
function somaDias(iso, delta) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// periodo: "hoje" | "ontem" | número de dias (1..90). Retorna {since, until, label}.
export function intervaloMeta(raw, maxDias = 90) {
  const v = String(raw ?? '30').trim();
  const hoje = hojeSP();
  if (v === 'hoje') return { since: hoje, until: hoje, label: 'hoje' };
  if (v === 'ontem') { const o = somaDias(hoje, -1); return { since: o, until: o, label: 'ontem' }; }
  const n = Number.parseInt(v, 10);
  const dias = Number.isFinite(n) && n > 0 ? Math.min(n, maxDias) : 30;
  return { since: somaDias(hoje, -(dias - 1)), until: hoje, label: `ultimos_${dias}_dias` };
}

async function graphPaginado(url) {
  const out = [];
  let next = url;
  let pages = 0;
  while (next && pages++ < MAX_PAGES) {
    const r = await fetchMeta(next);
    const j = await r.json();
    if (j.error) throw new Error(`Meta: ${String(j.error.message || 'erro').slice(0, 200)}`);
    out.push(...(j.data || []));
    next = j.paging?.next || null;
  }
  return out;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const insDe = (e) => (Array.isArray(e?.insights?.data) ? e.insights.data[0] : null) || null;
const linkClicks = (ins) => num((ins?.actions || []).find(a => a.action_type === 'link_click')?.value);

function roasDe(ins) {
  const r = (ins?.purchase_roas || []).find(x => x.action_type === 'omni_purchase') || (ins?.purchase_roas || [])[0];
  return r ? round2(num(r.value)) : null;
}

// Busca campanhas + conjuntos de UM cliente e monta o resumo.
export async function metaAdsDoCliente(cliente, { since, until }, { nivel = 'campanha', somenteAtivas = false, incluirSemGasto = false, limite = 100 } = {}) {
  const accountId = normalizeAccountId(cliente.account_id);
  if (!accountId) throw new Error('Cliente sem conta de anúncios configurada.');

  // Token do próprio cliente (com fallback no global), igual ao painel.
  const token = await getTokenForUser({ cliente_id: cliente.id, is_admin: false });
  if (!token) throw new Error('Sem token Meta configurado para este cliente.');

  const range = `time_range({"since":"${since}","until":"${until}"})`;
  const filtro = somenteAtivas
    ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]))}`
    : '';

  const campFields = `name,status,effective_status,objective,insights.${range}{spend,impressions,reach,actions,action_values,purchase_roas,conversions}`;
  const adsetFields = `campaign_id,name,status,optimization_goal,promoted_object{custom_event_type,custom_event_str},insights.${range}{spend,reach,actions,conversions}`;

  const [campanhas, conjuntos, conta] = await Promise.all([
    graphPaginado(`${GRAPH}/act_${accountId}/campaigns?fields=${encodeURIComponent(campFields)}&limit=200${filtro}&access_token=${token}`),
    graphPaginado(`${GRAPH}/act_${accountId}/adsets?fields=${encodeURIComponent(adsetFields)}&limit=200${filtro}&access_token=${token}`),
    fetchMeta(`${GRAPH}/act_${accountId}?fields=currency&access_token=${token}`).then(r => r.json()).catch(() => ({})),
  ]);

  const campPorId = new Map(campanhas.map(c => [c.id, c]));
  const conjPorCamp = new Map();
  for (const a of conjuntos) {
    if (!conjPorCamp.has(a.campaign_id)) conjPorCamp.set(a.campaign_id, []);
    conjPorCamp.get(a.campaign_id).push(a);
  }

  // Resultados por campanha = soma dos conjuntos, agrupada por tipo.
  const linhasCamp = campanhas.map(c => {
    const ins = insDe(c);
    const gasto = num(ins?.spend);
    const partes = somarPorTipo((conjPorCamp.get(c.id) || []).map(a => {
      const i = insDe(a);
      return i ? resultadoDoConjunto(i, a, c.objective) : null;
    }));
    const cliques = linkClicks(ins);
    const imp = num(ins?.impressions);
    return {
      id: c.id,
      nome: c.name,
      status: c.effective_status || c.status,
      objetivo: c.objective,
      gasto: round2(gasto),
      impressoes: imp,
      alcance: num(ins?.reach),
      cliques_link: cliques,
      ctr_link_pct: imp ? round2(cliques / imp * 100) : null,
      cpc_link: cliques ? round2(gasto / cliques) : null,
      resultados: partes,
      custo_por_resultado: partes.length === 1 ? round2(gasto / partes[0].valor) : null,
      roas: roasDe(ins),
    };
  }).filter(l => incluirSemGasto || l.gasto > 0)
    .sort((a, b) => b.gasto - a.gasto);

  const gastoTotal = round2(linhasCamp.reduce((s, l) => s + l.gasto, 0));
  const resultadosTotal = somarPorTipo(linhasCamp.flatMap(l => l.resultados.map(r => ({ label: r.tipo, value: r.valor }))));
  const resumo = {
    cliente_id: cliente.id,
    cliente: cliente.nome,
    conta: `act_${accountId}`,
    moeda: conta?.currency || null,
    campanhas_com_gasto: linhasCamp.filter(l => l.gasto > 0).length,
    gasto_total: gastoTotal,
    resultados_por_tipo: resultadosTotal,
    custo_por_resultado: resultadosTotal.length === 1 ? round2(gastoTotal / resultadosTotal[0].valor) : null,
  };

  if (nivel === 'conjunto') {
    const linhasConj = conjuntos.map(a => {
      const i = insDe(a);
      const camp = campPorId.get(a.campaign_id);
      const r = i ? resultadoDoConjunto(i, a, camp?.objective) : null;
      const gasto = num(i?.spend);
      return {
        id: a.id,
        nome: a.name,
        campanha: camp?.name || a.campaign_id,
        status: a.status,
        meta_de_conversao: a.optimization_goal,
        gasto: round2(gasto),
        alcance: num(i?.reach),
        resultado: r && r.value ? { tipo: r.label, valor: r.value } : null,
        custo_por_resultado: r && r.value ? round2(gasto / r.value) : null,
      };
    }).filter(l => incluirSemGasto || l.gasto > 0).sort((x, y) => y.gasto - x.gasto);
    return { resumo, conjuntos: linhasConj.slice(0, limite), truncado: linhasConj.length > limite };
  }

  return { resumo, campanhas: linhasCamp.slice(0, limite), truncado: linhasCamp.length > limite };
}

// Todos os clientes com conta: só os totais por cliente (rápido de ler e de transmitir).
export async function metaAdsConsolidado(intervalo, opcoes = {}) {
  const r = await getPool().query(
    `SELECT id, nome, account_id FROM clientes
     WHERE archived_at IS NULL AND account_id IS NOT NULL AND account_id <> ''
     ORDER BY nome ASC LIMIT 60`
  );
  const clientes = r.rows;
  const resultados = [];
  const erros = [];
  const fila = [...clientes];
  const worker = async () => {
    while (fila.length) {
      const c = fila.shift();
      try {
        const d = await metaAdsDoCliente(c, intervalo, { ...opcoes, limite: 0 });
        resultados.push(d.resumo);
      } catch (e) {
        erros.push({ cliente_id: c.id, cliente: c.nome, erro: String(e.message || 'erro').slice(0, 160) });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker)); // 4 em paralelo
  resultados.sort((a, b) => b.gasto_total - a.gasto_total);
  return { por_cliente: resultados, erros, clientes_consultados: clientes.length };
}
