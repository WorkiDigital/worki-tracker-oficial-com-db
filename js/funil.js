// Funil de Vendas (Chart.js)
// js/funil.js

let _funilCarregado = false;
let _charts = {};

async function funilInit() {
    if (!_funilCarregado) {
        _funilCarregado = true;
        _funilBindEvents();
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
        if (typeof clienteAdminSelecionado !== 'undefined' && clienteAdminSelecionado) {
            params.set('cliente_id', clienteAdminSelecionado);
        }

        const r = await authFetch(`/api/metrics-funnel?${params}`);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || `Erro ${r.status}`);
        }

        const data = await r.json();
        _funilRenderVisaoGeral(data.overview || {});
        _funilRenderOrigens(Array.isArray(data.timeline) ? data.timeline : []);
        _funilRenderJornada(data.journey, data.overview || {});
        _funilRenderAbandono(data.dropoff);
        _funilRenderTiming(data.timing || {});
        _funilRenderPerformance(data.performance);
        _funilRenderFaturamento(Array.isArray(data.sales_timeline) ? data.sales_timeline : []);
    } catch (e) {
        console.error(e);
        toast('Erro ao carregar dados do funil: ' + e.message, 'error');
    } finally {
        if (container) container.classList.remove('loading-overlay-active');
    }
}

function _funilInt(value) {
    return Number.parseInt(value || 0, 10) || 0;
}

function _funilNum(value) {
    return Number.parseFloat(value || 0) || 0;
}

function _funilPct(num, den) {
    return den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
}

function _formatPct(value) {
    const num = _funilNum(value);
    return `${num.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function _formatNumber(value) {
    return _funilInt(value).toLocaleString('pt-BR');
}

function _formatMoney(value) {
    return _funilNum(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _formatTime(min) {
    const value = _funilNum(min);
    if (!value || value <= 0) return '-';
    if (value < 60) return `${Math.round(value)} min`;
    const h = value / 60;
    if (h < 24) return `${Math.round(h)} hora${Math.round(h) !== 1 ? 's' : ''}`;
    const d = h / 24;
    return `${Math.round(d)} dia${Math.round(d) !== 1 ? 's' : ''}`;
}

function _formatHours(hours) {
    const value = _funilNum(hours);
    if (!value || value <= 0) return '-';
    if (value < 1) return `${Math.round(value * 60)} min`;
    if (value < 24) return `${Math.round(value)} hora${Math.round(value) !== 1 ? 's' : ''}`;
    const d = value / 24;
    return `${Math.round(d)} dia${Math.round(d) !== 1 ? 's' : ''}`;
}

function _formatDays(days) {
    const value = _funilNum(days);
    if (!value || value <= 0) return '-';
    if (value < 1) return `${Math.max(1, Math.round(value * 24))} h`;
    return `${Math.round(value)} dia${Math.round(value) !== 1 ? 's' : ''}`;
}

function _funilEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

// 1. Visao geral das conversas
function _funilRenderVisaoGeral(ov) {
    const total = _funilInt(ov.total_leads);
    const untracked = _funilInt(ov.untracked);
    const tracked = Math.max(0, total - untracked);
    const avgResponse = _funilNum(ov.avg_response_min);

    const pctTracked = total > 0 ? ((tracked / total) * 100).toFixed(1) : 0;
    const pctUntracked = total > 0 ? ((untracked / total) * 100).toFixed(1) : 0;

    const el = (id) => document.getElementById(id);
    if (el('fgTotal')) el('fgTotal').textContent = _formatNumber(total);
    if (el('fgTrackedVal')) el('fgTrackedVal').textContent = _formatNumber(tracked);
    if (el('fgTrackedPct')) el('fgTrackedPct').textContent = `${pctTracked}%`;
    if (el('fgUntrackedVal')) el('fgUntrackedVal').textContent = _formatNumber(untracked);
    if (el('fgUntrackedPct')) el('fgUntrackedPct').textContent = `${pctUntracked}%`;
    if (el('fgAvgResponse')) el('fgAvgResponse').textContent = _formatTime(avgResponse);

    if (window.Chart) {
        const ctx = document.getElementById('chartVisaoGeral');
        if (ctx) {
            if (_charts.visaoGeral) _charts.visaoGeral.destroy();
            _charts.visaoGeral = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Rastreadas', 'Nao rastreadas'],
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
            const centerText = el('chartVisaoGeralCenter');
            if (centerText) centerText.textContent = _formatNumber(total);
        }
    }
}

// 2. Origem das conversas
function _funilRenderOrigens(timeline) {
    const labels = timeline.map(t => t.date_label);
    const dataMeta = timeline.map(t => _funilInt(t.meta_ads));
    const dataGoogle = timeline.map(t => _funilInt(t.google_ads));
    const dataOutras = timeline.map(t => _funilInt(t.other));
    const dataNaoRast = timeline.map(t => _funilInt(t.untracked));

    const el = (id) => document.getElementById(id);
    if (el('foMeta')) el('foMeta').textContent = _formatNumber(dataMeta.reduce((a, b) => a + b, 0));
    if (el('foGoogle')) el('foGoogle').textContent = _formatNumber(dataGoogle.reduce((a, b) => a + b, 0));
    if (el('foOutras')) el('foOutras').textContent = _formatNumber(dataOutras.reduce((a, b) => a + b, 0));
    if (el('foNaoRast')) el('foNaoRast').textContent = _formatNumber(dataNaoRast.reduce((a, b) => a + b, 0));

    if (window.Chart) {
        const ctx = document.getElementById('chartOrigens');
        if (ctx) {
            if (_charts.origens) _charts.origens.destroy();
            _charts.origens = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Meta Ads', data: dataMeta, backgroundColor: '#1877f2' },
                        { label: 'Google Ads', data: dataGoogle, backgroundColor: '#34a853' },
                        { label: 'Outras Origens', data: dataOutras, backgroundColor: '#64748b' },
                        { label: 'Nao rastreada', data: dataNaoRast, backgroundColor: '#f97316' }
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

function _funilFallbackJourney(ov) {
    const total = _funilInt(ov.total_leads);
    const contato = _funilInt(ov.first_contact || ov.total_leads);
    const venda = _funilInt(ov.sales);
    return [
        {
            key: 'contact',
            label: 'Fez contato',
            count: contato,
            cumulative_rate: _funilPct(contato, total),
            step_rate: 100,
            lost_from_previous: 0,
            lost_rate: 0,
        },
        {
            key: 'purchase',
            label: 'Comprou',
            count: venda,
            cumulative_rate: _funilPct(venda, total || contato),
            step_rate: _funilPct(venda, contato),
            lost_from_previous: Math.max(0, contato - venda),
            lost_rate: _funilPct(Math.max(0, contato - venda), contato),
        },
    ];
}

// 3. Funil da jornada de compra
function _funilRenderJornada(journey, ov) {
    const stages = Array.isArray(journey) && journey.length ? journey : _funilFallbackJourney(ov);
    const maxCount = Math.max(...stages.map(stage => _funilInt(stage.count)), 1);
    const palette = ['#0ea5e9', '#2563eb', '#7c3aed', '#f97316', '#16a34a', '#dc2626', '#64748b'];

    const fjWrap = document.getElementById('fjWrap');
    if (!fjWrap) return;

    fjWrap.innerHTML = stages.map((stage, index) => {
        const count = _funilInt(stage.count);
        const width = count > 0 ? Math.max(7, Math.round((count / maxCount) * 100)) : 0;
        const color = palette[index % palette.length];
        return `
            <div class="fj-stage">
                <div class="fj-stage-main">
                    <div class="fj-stage-name">${_funilEscape(stage.label || 'Etapa')}</div>
                    <div class="fj-stage-count">${_formatNumber(count)}</div>
                </div>
                <div class="fj-stage-track">
                    <div class="fj-stage-fill" style="width:${width}%;background:${color};"></div>
                </div>
                <div class="fj-stage-meta">
                    <span>${_formatPct(stage.cumulative_rate)} do topo</span>
                    <span>${index === 0 ? 'inicio' : `${_formatPct(stage.step_rate)} da anterior`}</span>
                </div>
            </div>
        `;
    }).join('');
}

function _funilRenderAbandono(dropoff) {
    const el = document.getElementById('fjDropoff');
    if (!el) return;

    const rows = Array.isArray(dropoff)
        ? dropoff.filter(item => _funilInt(item.lost) > 0).slice(0, 3)
        : [];

    if (!rows.length) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = `
        <div class="fj-dropoff-title">Gargalos</div>
        ${rows.map(item => `
            <div class="fj-dropoff-row">
                <span>${_funilEscape(item.from)} -> ${_funilEscape(item.to)}</span>
                <strong>${_formatNumber(item.lost)} (${_formatPct(item.lost_rate)})</strong>
            </div>
        `).join('')}
    `;
}

function _funilRenderTiming(timing) {
    const el = document.getElementById('fjTiming');
    if (!el) return;

    const cards = [
        { label: '1a resposta', value: _formatTime(timing.first_response_min) },
        { label: 'Qualificacao', value: _formatHours(timing.qualified_hours) },
        { label: 'Proposta', value: _formatHours(timing.proposal_hours) },
        { label: 'Venda', value: _formatDays(timing.sale_days) },
    ];

    el.innerHTML = cards.map(card => `
        <div class="fj-timing-card">
            <span>${card.label}</span>
            <strong>${card.value}</strong>
        </div>
    `).join('');
}

function _funilRenderPerformance(performance) {
    const el = document.getElementById('frTable');
    if (!el) return;

    const rows = Array.isArray(performance) ? performance : [];
    if (!rows.length) {
        el.innerHTML = '<div class="funil-empty">Nenhum dado por campanha no periodo.</div>';
        return;
    }

    el.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Campanha</th>
                    <th>Conjunto</th>
                    <th>Anuncio</th>
                    <th>Contatos</th>
                    <th>Qualif.</th>
                    <th>Propostas</th>
                    <th>Vendas</th>
                    <th>Receita</th>
                    <th>Taxa</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        <td title="${_funilEscape(row.campaign)}">${_funilEscape(row.campaign)}</td>
                        <td title="${_funilEscape(row.adset)}">${_funilEscape(row.adset)}</td>
                        <td title="${_funilEscape(row.ad)}">${_funilEscape(row.ad)}</td>
                        <td>${_formatNumber(row.contacts)}</td>
                        <td>${_formatNumber(row.qualified)}</td>
                        <td>${_formatNumber(row.proposals)}</td>
                        <td>${_formatNumber(row.sales)}</td>
                        <td>R$ ${_formatMoney(row.revenue)}</td>
                        <td>${_formatPct(row.close_rate)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// 4. Faturamento total
function _funilRenderFaturamento(sales) {
    const labels = sales.map(s => s.date_label);
    const dataCount = sales.map(s => _funilInt(s.count));
    const dataRev = sales.map(s => _funilNum(s.revenue));

    const totalVendas = dataCount.reduce((a, b) => a + b, 0);
    const totalFat = dataRev.reduce((a, b) => a + b, 0);

    const el = (id) => document.getElementById(id);
    if (el('ffTotalVendas')) el('ffTotalVendas').textContent = _formatNumber(totalVendas);
    if (el('ffFaturamento')) el('ffFaturamento').textContent = _formatMoney(totalFat);

    if (window.Chart) {
        const ctx = document.getElementById('chartFaturamento');
        if (ctx) {
            if (_charts.faturamento) _charts.faturamento.destroy();
            _charts.faturamento = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
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
