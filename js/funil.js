// ── Funil de Vendas (Chart.js) ─────────────────────────────────────────────
// js/funil.js

let _funilCarregado = false;
let _charts = {};

async function funilInit() {
    if (!_funilCarregado) {
        _funilCarregado = true;
        _funilBindEvents();
        // Carrega Chart.js sob demanda se não estiver carregado
        if (!window.Chart) {
            try {
                await loadScript('https://cdn.jsdelivr.net/npm/chart.js');
            } catch (e) {
                console.error('Falha ao carregar Chart.js', e);
            }
        }
    }
    await funilCarregar();
}

function _funilBindEvents() {
    document.getElementById('funilPeriodo')?.addEventListener('change', funilCarregar);
}

async function funilCarregar() {
    const periodo = document.getElementById('funilPeriodo')?.value || '30';

    const container = document.getElementById('aba-funil');
    if (container) container.classList.add('loading-overlay-active');

    try {
        const params = new URLSearchParams({ periodo });
        // Admin filtra por cliente via o seletor global do topo (mesmo padrão
        // já usado em Leads/Captação/Inteligente) — sem seletor duplicado na aba.
        if (typeof clienteAdminSelecionado !== 'undefined' && clienteAdminSelecionado) {
            params.set('cliente_id', clienteAdminSelecionado);
        }
        const r = await authFetch(`/api/metrics-funnel?${params}`);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || `Erro ${r.status}`);
        }
        const data = await r.json();

        // "Visão Geral das Conversas" e "Origem das Conversas" migraram pra aba
        // Relatórios (2026-09, ver relRelatoriosCarregarFunilData abaixo) — a aba
        // Funil ficou dedicada só ao progresso de venda em si.
        _funilRenderJornada(data.overview);
        _funilRenderFaturamento(data.sales_timeline);

    } catch (e) {
        console.error(e);
        toast('Erro ao carregar dados do funil: ' + e.message, 'error');
    } finally {
        if (container) container.classList.remove('loading-overlay-active');
    }
}

// ── Rastreamento de Conversas (aba Relatórios) ──────────────────────────────
// Chama o MESMO endpoint /api/metrics-funnel que a aba Funil de Vendas usa,
// mas com o período/cliente da aba Relatórios (independente do #funilPeriodo)
// — 2 chamadas HTTP leves em vez de mover a lógica de cálculo, que fica só no
// backend (ver CLAUDE.md: bugs de Origem/Comprou já corrigidos em
// api/metrics-funnel.js — não duplicar essa regra em outro lugar).
async function relRelatoriosCarregarFunilData(params) {
    try {
        const r = await authFetch(`/api/metrics-funnel?${params}`);
        if (!r.ok) throw new Error(`Erro ${r.status}`);
        const data = await r.json();
        _funilRenderVisaoGeral(data.overview, 'rel');
        _funilRenderOrigens(data.timeline, 'rel');
    } catch (e) {
        console.error('[Relatórios] Falha ao carregar Rastreamento de Conversas:', e);
        // Best-effort: uma falha aqui não deve travar o resto de Relatórios
        // (mesmo padrão de carregarEngajamentoMedio() em js/leads.js).
    }
}

function _formatTime(min) {
    if (!min || min <= 0) return '—';
    if (min < 60) return `${Math.round(min)} min`;
    const h = min / 60;
    if (h < 24) return `${Math.round(h)} hora${Math.round(h) !== 1 ? 's' : ''}`;
    return `${Math.round(h/24)} dia${Math.round(h/24) !== 1 ? 's' : ''}`;
}

// 1. Visão Geral das Conversas (Gauge / Doughnut)
// prefix: prefixo dos ids no HTML — hoje só "rel" (aba Relatórios) é usado de
// verdade; o parâmetro existe pra função servir os 2 lugares sem duplicar código.
function _funilRenderVisaoGeral(ov, prefix) {
    const p = prefix || 'rel';
    const total = parseInt(ov.total_leads) || 0;
    const untracked = parseInt(ov.untracked) || 0;
    const tracked = total - untracked;
    const avgResponse = parseFloat(ov.avg_response_min) || 0;

    const pctTracked = total > 0 ? ((tracked / total) * 100).toFixed(1) : 0;
    const pctUntracked = total > 0 ? ((untracked / total) * 100).toFixed(1) : 0;

    const el = (id) => document.getElementById(id);
    if (el(`${p}Total`)) el(`${p}Total`).textContent = total;
    if (el(`${p}TrackedVal`)) el(`${p}TrackedVal`).textContent = tracked;
    if (el(`${p}TrackedPct`)) el(`${p}TrackedPct`).textContent = `${pctTracked}%`;
    if (el(`${p}UntrackedVal`)) el(`${p}UntrackedVal`).textContent = untracked;
    if (el(`${p}UntrackedPct`)) el(`${p}UntrackedPct`).textContent = `${pctUntracked}%`;
    if (el(`${p}AvgResponse`)) el(`${p}AvgResponse`).textContent = _formatTime(avgResponse);

    if (window.Chart) {
        const ctx = document.getElementById(`${p}ChartVisaoGeral`);
        if (ctx) {
            const chartKey = `visaoGeral_${p}`;
            if (_charts[chartKey]) _charts[chartKey].destroy();
            _charts[chartKey] = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Rastreadas', 'Não rastreadas'],
                    datasets: [{
                        data: [tracked, untracked],
                        backgroundColor: ['#25d366', '#f97316'],
                        borderWidth: 0,
                        circumference: 180,
                        rotation: 270
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '80%',
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: true },
                        datalabels: { display: false }
                    }
                }
            });
            // Update center text manually since ChartJS 3+ doesn't have it built-in easily
            const centerText = el(`${p}ChartVisaoGeralCenter`);
            if (centerText) centerText.textContent = total;
        }
    }
}

// 2. Origem das Conversas (Bar Stacked)
function _funilRenderOrigens(timeline, prefix) {
    const p = prefix || 'rel';
    const labels = timeline.map(t => t.date_label);
    const dataMeta = timeline.map(t => parseInt(t.meta_ads) || 0);
    const dataGoogle = timeline.map(t => parseInt(t.google_ads) || 0);
    const dataOutras = timeline.map(t => parseInt(t.other) || 0);
    const dataNaoRast = timeline.map(t => parseInt(t.untracked) || 0);

    const el = (id) => document.getElementById(id);
    if (el(`${p}Meta`)) el(`${p}Meta`).textContent = dataMeta.reduce((a,b)=>a+b, 0);
    if (el(`${p}Google`)) el(`${p}Google`).textContent = dataGoogle.reduce((a,b)=>a+b, 0);
    if (el(`${p}Outras`)) el(`${p}Outras`).textContent = dataOutras.reduce((a,b)=>a+b, 0);
    if (el(`${p}NaoRast`)) el(`${p}NaoRast`).textContent = dataNaoRast.reduce((a,b)=>a+b, 0);

    if (window.Chart) {
        const ctx = document.getElementById(`${p}ChartOrigens`);
        if (ctx) {
            const chartKey = `origens_${p}`;
            if (_charts[chartKey]) _charts[chartKey].destroy();
            _charts[chartKey] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Meta Ads', data: dataMeta, backgroundColor: '#1877f2' },
                        { label: 'Google Ads', data: dataGoogle, backgroundColor: '#34a853' },
                        { label: 'Outras Origens', data: dataOutras, backgroundColor: '#64748b' },
                        { label: 'Não rastreada', data: dataNaoRast, backgroundColor: '#f97316' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true, grid: { display: false } },
                        y: { stacked: true, border: { display: false } }
                    },
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } },
                        // Sem isso o datalabels (registrado globalmente) usa o default preto,
                        // ilegivel sobre azul/cinza em ambos os temas. Branco + contorno escuro
                        // garante contraste nas duas paletas; oculta quando o segmento e 0 (o
                        // "0" flutuando sobre a barra vizinha era so ruido visual).
                        datalabels: {
                            display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) > 0,
                            color: '#fff',
                            font: { weight: '700', size: 11 },
                            textStrokeColor: 'rgba(0,0,0,.55)',
                            textStrokeWidth: 2,
                        }
                    }
                }
            });
        }
    }
}

// 3. Funil da Jornada de Compra — mesmo padrão trapezoidal do Funil de
// Conversão (Meta Ads, .funil-trap) para manter o layout padrão em todo o painel.
function _funilRenderJornada(ov) {
    const total = parseInt(ov.total_leads) || 0;
    const contato = parseInt(ov.first_contact) || 0;
    const venda = parseInt(ov.sales) || 0;

    const pctContato = total > 0 ? ((contato / total) * 100).toFixed(1) : '0.0';
    const pctVenda = total > 0 ? ((venda / total) * 100).toFixed(1) : '0.0';
    const taxaVenda = contato > 0 ? ((venda / contato) * 100).toFixed(1) : '0.0';

    const fjWrap = document.getElementById('fjWrap');
    if (fjWrap) {
        fjWrap.innerHTML = `
            <div class="funil-tri-wrap">
                <div class="funil-trap" style="width:100%;background:#0ea5e9;">
                    <div class="funil-trap-top">
                        <span class="funil-trap-label">Fez Contato</span>
                        <span class="funil-trap-num">${fmtN(contato)}</span>
                    </div>
                    <div class="funil-trap-cost">${pctContato}% dos leads</div>
                </div>
                <div class="funil-tri-rate">${taxaVenda}% Conversão</div>
                <div class="funil-trap" style="width:46%;background:#0369a1;">
                    <div class="funil-trap-top">
                        <span class="funil-trap-label">Comprou</span>
                        <span class="funil-trap-num">${fmtN(venda)}</span>
                    </div>
                    <div class="funil-trap-cost">${pctVenda}% dos leads</div>
                </div>
            </div>
        `;
    }
}

// 4. Faturamento Total (Bar Timeline)
function _funilRenderFaturamento(sales) {
    const labels = sales.map(s => s.date_label);
    const dataCount = sales.map(s => parseInt(s.count) || 0);
    const dataRev = sales.map(s => parseFloat(s.revenue) || 0);

    const totalVendas = dataCount.reduce((a,b)=>a+b, 0);
    const totalFat = dataRev.reduce((a,b)=>a+b, 0);

    const el = (id) => document.getElementById(id);
    if (el('ffTotalVendas')) el('ffTotalVendas').textContent = totalVendas;
    if (el('ffFaturamento')) el('ffFaturamento').textContent = totalFat.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    if (window.Chart) {
        const ctx = document.getElementById('chartFaturamento');
        if (ctx) {
            if (_charts.faturamento) _charts.faturamento.destroy();
            _charts.faturamento = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Vendas', data: dataCount, backgroundColor: '#38bdf8', maxBarThickness: 50 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { display: false } },
                        y: { border: { display: false }, ticks: { precision: 0 } }
                    },
                    plugins: {
                        legend: { display: false },
                        // anchor/align 'start' desenha o numero DENTRO da barra (perto do
                        // topo), sempre sobre o azul — branco+contorno da contraste nos
                        // dois temas sem depender da cor de fundo do card por tras da barra.
                        datalabels: {
                            display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) > 0,
                            color: '#fff',
                            anchor: 'end',
                            align: 'start',
                            offset: 4,
                            font: { weight: '700', size: 11 },
                            textStrokeColor: 'rgba(0,0,0,.55)',
                            textStrokeWidth: 2,
                        }
                    }
                }
            });
        }
    }
}

window.funilInit = funilInit;
window.funilCarregar = funilCarregar;
