// ── Leads (extracted from index.html) ──────────────────────────
let chumboAtivo = null;

async function recarregarLeads(silencioso = false) {
    const dot   = $('refreshDot');
    const label = $('refreshLabel');
    dot.className   = 'refresh-dot loading';
    label.textContent = silencioso ? 'atualizando...' : 'carregando...';

    const icon = $('reloadIcon');
    if (icon) icon.style.animation = 'spin 1s linear infinite';

    if (!silencioso) renderSkeleton();

    try {
        // Dispara a fase 3 (métricas) em paralelo, não bloqueia a tabela
        carregarMetricasTemporais();

        const data = await authFetch('/api/leads').then(r=>r.json());
        if (!Array.isArray(data)) throw new Error(data.error || 'Erro ao buscar leads');
        rawData = data;
        popularFiltroInstancias();
        aplicarFiltros();

        const agora = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
        dot.className   = 'refresh-dot';
        label.textContent = `atualizado ${agora}`;
    } catch(e) {
        dot.className   = 'refresh-dot';
        dot.style.background = 'var(--red)';
        label.textContent = 'erro ao carregar';
        if (!silencioso) toast(e.message, 'error');
    } finally {
        if (icon) icon.style.animation = '';
        lucide.createIcons({ nodes: [icon?.parentElement].filter(Boolean) });
    }
}

async function carregarMetricasTemporais() {
    try {
        const periodo = $('periodoSelect')?.value;
        const range = periodo ? calcRange(periodo) : null;
        
        let url = '/api/metrics-temporal?';
        const params = new URLSearchParams();
        
        if (clienteAdminSelecionado) params.append('cliente_id', clienteAdminSelecionado);
        if (range) {
            params.append('start', range[0].toISOString());
            params.append('end', range[1].toISOString());
        }

        const data = await authFetch(url + params.toString()).then(r => r.json());
        if (data.error) return;

        if ($('avgCycleDays')) $('avgCycleDays').textContent = data.avgCycleDays;
        if ($('avgResponseTime')) $('avgResponseTime').textContent = data.avgResponseMin;
        if ($('leadsAtRisk')) $('leadsAtRisk').textContent = data.leadsAtRisk;
        if ($('fastSales')) $('fastSales').textContent = data.fastSales;
        if ($('fastSalesPercentLabel')) $('fastSalesPercentLabel').textContent = `${data.fastSalesPercent}% das vendas em 24h`;
        
    } catch (e) {
        console.error('Erro ao carregar métricas temporais:', e);
    }
}

function renderSkeleton() {
    const tbody = $('tabela-corpo');
    tbody.innerHTML = Array.from({length:8}, () => `
        <tr class="sk-row">
            ${Array.from({length:8}, () => `<td><div class="sk-line skeleton" style="width:${60+Math.random()*40}%"></div></td>`).join('')}
        </tr>`).join('');
    $('leadsCount').textContent = '—';
    $('paginacao').innerHTML = '';
}

// ── Filtros ────────────────────────────────────────────────────
function onPeriodoChange() {
    const v = $('periodoSelect').value;
    $('areaPersonalizada').style.display = v === 'personalizado' ? 'flex' : 'none';
    if (v !== 'personalizado') aplicarFiltros();
}

function calcRange(periodo) {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);
    if (periodo === 'hoje')   return [hoje, amanha];
    if (periodo === 'ontem')  { const d=new Date(hoje); d.setDate(d.getDate()-1); return [d, hoje]; }
    if (periodo === '7dias')  { const d=new Date(hoje); d.setDate(d.getDate()-7); return [d, amanha]; }
    if (periodo === '14dias') { const d=new Date(hoje); d.setDate(d.getDate()-14); return [d, amanha]; }
    if (periodo === 'esteMes') { 
        const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); 
        return [d, amanha]; 
    }
    if (periodo === 'mesPassado') { 
        const d1 = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1);
        const d2 = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        return [d1, d2];
    }
    if (periodo === 'personalizado') {
        const a = $('dataInicio').value, b = $('dataFim').value;
        if (a && b) { const f=new Date(b); f.setDate(f.getDate()+1); return [new Date(a), f]; }
    }
    return null;
}

function aplicarFiltros() {
    const busca   = ($('inputBusca').value||'').toLowerCase().trim();
    const periodo = $('periodoSelect').value;
    const range   = calcRange(periodo);
    const instanciaFiltro = ($('selectInstancia')?.value || '');

    dadosFiltrados = rawData.filter(l => {
        if (clienteAdminSelecionado && l.cliente_id !== clienteAdminSelecionado) return false;
        
        // Filtro por instância
        if (instanciaFiltro && l.instancia !== instanciaFiltro) return false;

        if (busca) {
            const n = (l.nome||'').toLowerCase();
            const t = (l.telefone||'').toLowerCase();
            if (!n.includes(busca) && !t.includes(busca)) return false;
        }
        if (range) {
            const d = new Date(l.event_time || l.created_at || 0);
            if (d < range[0] || d >= range[1]) return false;
        }
        return true;
    });

    // Ordenação
    dadosFiltrados.sort((a,b) => {
        let va = a[sortCol]||'', vb = b[sortCol]||'';
        if (sortCol === 'event_time') { va = new Date(va); vb = new Date(vb); }
        return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });

    pagAtual = 1;
    renderTabela();
    renderRelatorios();
    
    // Atualiza as métricas do topo (cards) baseadas no filtro atual
    carregarMetricasTemporais();
}

// ── Filtro de Instâncias ──────────────────────────────────────
function popularFiltroInstancias() {
    const sel = $('selectInstancia');
    if (!sel) return;

    const valorAtual = sel.value;
    
    // Filtra os leads pelo cliente selecionado antes de extrair instâncias únicas
    const leadsVisiveis = clienteAdminSelecionado 
        ? rawData.filter(l => l.cliente_id === clienteAdminSelecionado)
        : rawData;

    const instancias = [...new Set(leadsVisiveis.map(l => l.instancia).filter(Boolean))].sort();
    
    let html = '<option value="">Todas instâncias</option>';
    instancias.forEach(inst => {
        html += `<option value="${esc(inst)}">${esc(inst)}</option>`;
    });
    sel.innerHTML = html;
    
    // Tenta manter a seleção anterior se ela ainda existir
    if (instancias.includes(valorAtual)) {
        sel.value = valorAtual;
    }
}

// Debounce na busca
$('inputBusca').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(aplicarFiltros, 280);
});

// ── Sorting ────────────────────────────────────────────────────
function sortBy(col) {
    if (sortCol === col) sortDir *= -1;
    else { sortCol = col; sortDir = -1; }
 
    ['nome','status','event_time','lead_score'].forEach(c => {
        const el = $('sort-'+c);
        if (!el) return;
        el.textContent = c === sortCol ? (sortDir === 1 ? '↑' : '↓') : '↕';
        el.parentElement.classList.toggle('sort-asc',  c === sortCol && sortDir === 1);
        el.parentElement.classList.toggle('sort-desc', c === sortCol && sortDir === -1);
    });
    aplicarFiltros();
}

function tempoRelativo(data) {
    if (!data) return '-';
    const agora = new Date();
    const d = new Date(data);
    const diffMs = agora - d;
    const diffMin = Math.floor(diffMs / (1000 * 60));
    
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `${diffMin}m`;
    
    const diffHoras = Math.floor(diffMin / 60);
    if (diffHoras < 24) return `${diffHoras}h`;
    
    const diffDias = Math.floor(diffHoras / 24);
    return `${diffDias}d`;
}

// ── Render tabela com paginação ────────────────────────────────
function renderTabela() {
    const total  = dadosFiltrados.length;
    const inicio = (pagAtual-1) * POR_PAGINA;
    const pagina = dadosFiltrados.slice(inicio, inicio + POR_PAGINA);

    $('leadsCount').textContent = total;
    $('btnExport').style.display = 'flex';

    const tbody = $('tabela-corpo');
    if (!pagina.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted);">Nenhum lead encontrado.</td></tr>`;
        $('paginacao').innerHTML = '';
        return;
    }

    tbody.innerHTML = pagina.map((lead, i) => {
        const idx      = inicio + i;
        const plat     = (lead.plataforma||'instagram').toLowerCase();
        const platCls  = plat.includes('face') ? 'facebook' : plat.includes('whats') ? 'whatsapp' : 'instagram';
        const status   = (lead.status||'Lead').toLowerCase();
        const purchase = status === 'venda_fechada' || status === 'vendido';
        const stColor  = purchase ? '#10b981' : '';
        const stBorder = purchase ? '1px solid rgba(16,185,129,.3)' : 'transparent';
        const msg      = (lead.mensagem_recebida||'Sem mensagem').substring(0,35);
        const temCapi  = !!lead.pixel; 
        const data     = tempoRelativo(lead.event_time||lead.created_at);
        
        // FASE 2: Lead Score
        const score = lead.lead_score || 0;
        const scoreCls = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
        const scoreColor = score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#6b7280';

        // Tempo no Funil
        const tempoFunil = tempoRelativo(lead.created_at || lead.event_time);

        return `<tr>
            <td style="color:var(--text);font-weight:600;">${esc(lead.nome)||'N/A'}</td>
            <td>${esc(lead.telefone)||'N/A'}</td>
            <td><span class="tag" style="color:${stColor};border:${stBorder};">${esc(status)}</span></td>
            <td><span style="font-weight:700;color:${scoreColor};">${score}</span></td>
            <td title="${esc(lead.mensagem_recebida)}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${esc(msg)}${lead.mensagem_recebida?.length>35?'…':''}</td>
            <td style="font-size:12px;color:var(--muted);">${esc(lead.instancia||'—')}</td>
            <td><div class="platform-icon ${platCls}">${esc(lead.plataforma||'instagram')}</div></td>
            <td title="${esc(lead.event_time)}" style="white-space:nowrap;">${data}</td>
            <td style="font-size:11px;font-weight:600;">${tempoFunil}</td>
            <td>${temCapi ? `<button class="btn btn-green btn-sm" onclick="abrirModal(${idx})"><i data-lucide="zap" style="width:11px;"></i> Venda</button>` : '<span style="color:var(--muted);font-size:12px;">—</span>'}</td>
        </tr>`;
    }).join('');

    lucide.createIcons({ nodes: [tbody] });

    // Paginação
    const totalPags = Math.ceil(total / POR_PAGINA);
    renderPaginacao(totalPags, total, inicio);
}

function renderPaginacao(totalPags, total, inicio) {
    if (totalPags <= 1) { $('paginacao').innerHTML = ''; return; }
    const fim = Math.min(inicio + POR_PAGINA, total);
    let html = `<span class="page-info">Mostrando ${inicio+1}–${fim} de ${total}</span><div class="page-btns">`;
    html += `<button class="page-btn" onclick="irPagina(${pagAtual-1})" ${pagAtual===1?'disabled':''}>‹</button>`;

    // Janela de páginas
    const vizinhos = 2;
    for (let p=1; p<=totalPags; p++) {
        if (p===1 || p===totalPags || (p>=pagAtual-vizinhos && p<=pagAtual+vizinhos)) {
            html += `<button class="page-btn${p===pagAtual?' active':''}" onclick="irPagina(${p})">${p}</button>`;
        } else if (p===pagAtual-vizinhos-1 || p===pagAtual+vizinhos+1) {
            html += `<button class="page-btn" disabled style="cursor:default">…</button>`;
        }
    }
    html += `<button class="page-btn" onclick="irPagina(${pagAtual+1})" ${pagAtual===totalPags?'disabled':''}>›</button></div>`;
    $('paginacao').innerHTML = html;
}

function irPagina(p) {
    if (p < 1 || p > Math.ceil(dadosFiltrados.length/POR_PAGINA)) return;
    pagAtual = p;
    renderTabela();
    document.querySelector('.main').scrollTop = 0;
}

// ── Export CSV ─────────────────────────────────────────────────
function exportarCSV() {
    const cols = ['id','nome','telefone','status','plataforma','event_time','utm_campaign','utm_content','ctw_aci_id','mensagem_recebida','valor_venda'];
    const header = cols.join(';');
    const rows = dadosFiltrados.map(l => cols.map(c => `"${String(l[c]||'').replace(/"/g,'""')}"`).join(';'));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `leads_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast(`${dadosFiltrados.length} leads exportados`, 'success');
}

// ── Relatórios ─────────────────────────────────────────────────
function renderRelatorios() {
    const total  = dadosFiltrados.length;
    const vendas = dadosFiltrados.filter(l => (l.status||'').toLowerCase() === 'vendido');
    const receita = vendas.reduce((s,l) => s + parseFloat(l.valor_venda||0), 0);
    const conv   = total ? ((vendas.length/total)*100).toFixed(1) : 0;

    $('val-total').textContent   = total;
    $('val-vendas').textContent  = vendas.length;
    $('val-conv').textContent    = conv + '%';
    $('val-receita').textContent = brl(receita);

    const mapA  = agrupar(dadosFiltrados, 'utm_content');
    const mapP  = agrupar(dadosFiltrados, 'plataforma');
    const mapAV = agrupar(vendas, 'utm_content');
    const mapPV = agrupar(vendas, 'plataforma');

    criarGrafico('c1','l1',mapA,'doughnut');
    criarGrafico('c2','l2',mapP,'doughnut');
    criarGrafico('c3','l3',mapAV,'bar');
    criarGrafico('c4','l4',mapPV,'doughnut');
    
    // NOVO: Gráfico de Linha do Tempo
    renderTimelineChart();
    
    // NOVO: Heatmap de Horários
    renderHeatmap(window.currentHeatmapTipo || 'leads');
}

window.currentHeatmapTipo = 'leads';

function renderHeatmap(tipo) {
    window.currentHeatmapTipo = tipo;
    const btnLeads = $('btnHeatmapLeads');
    const btnVendas = $('btnHeatmapVendas');
    if (btnLeads) btnLeads.classList.toggle('active', tipo === 'leads');
    if (btnVendas) btnVendas.classList.toggle('active', tipo === 'vendas');
    
    const container = $('heatmapGrid');
    if (!container) return;
    
    let dados = dadosFiltrados;
    if (tipo === 'vendas') {
        dados = dadosFiltrados.filter(l => (l.status||'').toLowerCase() === 'vendido');
    }
    
    // Dias da semana: Dom a Sáb
    const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const matrix = Array(7).fill(0).map(() => Array(24).fill(0));
    
    let maxVal = 0;
    
    dados.forEach(l => {
        const dStr = l.event_time || l.created_at;
        if (!dStr) return;
        const d = new Date(dStr);
        if (isNaN(d.getTime())) return;
        
        const dia = d.getDay();
        const hora = d.getHours();
        matrix[dia][hora]++;
        if (matrix[dia][hora] > maxVal) {
            maxVal = matrix[dia][hora];
        }
    });
    
    // Render
    let html = '<div></div>'; // top-left empty corner
    for (let h=0; h<24; h++) {
        html += `<div class="heatmap-col-header">${h}h</div>`;
    }
    
    for (let d=0; d<7; d++) {
        html += `<div class="heatmap-row-label">${dias[d]}</div>`;
        for (let h=0; h<24; h++) {
            const val = matrix[d][h];
            let bg = 'var(--tag)';
            if (val > 0) {
                const intensity = maxVal > 1 ? 0.2 + (0.8 * (val / maxVal)) : 1.0;
                bg = `rgba(14, 165, 233, ${intensity.toFixed(2)})`;
            }
            const tooltip = val === 1 ? `1 ${tipo.slice(0,-1)} às ${h}h (${dias[d]})` : `${val} ${tipo} às ${h}h (${dias[d]})`;
            html += `<div class="heatmap-cell" style="background:${bg};" data-tooltip="${tooltip}"></div>`;
        }
    }
    
    container.innerHTML = html;
}

function renderTimelineChart() {
    const ctx = $('cTimeline');
    if (!ctx) return;

    // Agrupa dados por dia (últimos 30 dias por padrão ou conforme filtro)
    const timelineData = agruparPorDia(dadosFiltrados);
    const labels = timelineData.map(d => d.data);
    const leadsValues = timelineData.map(d => d.leads);
    const vendasValues = timelineData.map(d => d.vendas);

    if (graficos['cTimeline']) graficos['cTimeline'].destroy();

    const isDark = !document.documentElement.classList.contains('light');
    const gridC  = isDark ? '#1f2937' : '#e5e7eb';
    const tickC  = isDark ? '#8a8f98' : '#6b7280';

    graficos['cTimeline'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Leads',
                    data: leadsValues,
                    borderColor: '#0ea5e9',
                    backgroundColor: 'rgba(14, 165, 233, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                {
                    label: 'Vendas',
                    data: vendasValues,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: tickC, font: { size: 12, weight: '600' }, boxWidth: 12, usePointStyle: true }
                },
                datalabels: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: tickC, font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: gridC },
                    ticks: { color: tickC, font: { size: 10 }, stepSize: 1 }
                }
            }
        }
    });
}

function agruparPorDia(leads) {
    const dias = {};
    const hoje = new Date();
    
    // Determina o range de dias baseado no filtro atual ou últimos 15 dias
    const periodo = $('periodoSelect')?.value;
    let numDias = 15;
    if (periodo === '7dias') numDias = 7;
    if (periodo === '30dias') numDias = 30; // Se houver essa opção futuramente

    // Inicializa o mapa com os últimos N dias para garantir que dias vazios apareçam
    for (let i = numDias - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(hoje.getDate() - i);
        const key = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        dias[key] = { leads: 0, vendas: 0 };
    }

    // Preenche com os dados reais
    leads.forEach(l => {
        const dt = new Date(l.event_time || l.created_at);
        if (isNaN(dt.getTime())) return;
        const key = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        
        // Só adiciona se o dia estiver no nosso range (ou se for filtro "todos")
        if (dias[key] !== undefined || periodo === 'todos' || periodo === 'personalizado') {
            if (dias[key] === undefined) dias[key] = { leads: 0, vendas: 0 };
            dias[key].leads++;
            if ((l.status || '').toLowerCase() === 'vendido') {
                dias[key].vendas++;
            }
        }
    });

    // Converte para array ordenado
    return Object.entries(dias).map(([data, counts]) => ({ data, ...counts }));
}

function agrupar(arr, campo) {
    return arr.reduce((acc,l) => { const k=l[campo]||'Direto'; acc[k]=(acc[k]||0)+1; return acc; }, {});
}

function criarGrafico(canvasId, legendId, mapa, tipo) {
    if (graficos[canvasId]) graficos[canvasId].destroy();
    const labels = Object.keys(mapa).slice(0,8);
    const values = labels.map(k=>mapa[k]);
    const total  = values.reduce((a,b)=>a+b,0);
    const ctx    = $(canvasId); if (!ctx) return;

    const isDark = !document.documentElement.classList.contains('light');
    const gridC  = isDark ? '#1f2937' : '#e5e7eb';
    const tickC  = isDark ? '#8a8f98' : '#6b7280';

    const cfg = tipo === 'bar' ? {
        type:'bar',
        data:{ labels, datasets:[{ data:values, backgroundColor:CORES, borderRadius:6, borderSkipped:false }] },
        options:{ responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{display:false}, datalabels:{display:false} },
            scales:{ x:{ticks:{color:tickC,font:{size:9}},grid:{display:false}}, y:{ticks:{color:tickC},grid:{color:gridC}} } }
    } : {
        type:'doughnut',
        data:{ labels, datasets:[{ data:values, backgroundColor:CORES, borderWidth:0, hoverOffset:6 }] },
        options:{ responsive:true, maintainAspectRatio:false, cutout:'72%',
            plugins:{ legend:{display:false}, datalabels:{display:false} } }
    };

    graficos[canvasId] = new Chart(ctx, cfg);
    const legendEl = $(legendId);
    if (legendEl) {
        legendEl.innerHTML = labels.slice(0,5).map((l,i) => {
            const pct = total ? Math.round((values[i]/total)*100) : 0;
            return `<div class="legend-row">
                <div class="legend-left"><div class="legend-dot" style="background:${CORES[i%CORES.length]};"></div>${esc(l)}</div>
                <div class="legend-right"><span class="legend-val">${values[i]}</span><span class="legend-pct">${pct}%</span></div>
            </div>`;
        }).join('');
    }
}

// ── Modal CAPI ─────────────────────────────────────────────────
function abrirModal(idx) {
    chumboAtivo = dadosFiltrados[idx];
    $('modalLeadNome').textContent  = `Lead: ${chumboAtivo.nome || 'Desconhecido'}`;
    $('capiProduto').value  = chumboAtivo.produto || chumboAtivo.utm_content || '';
    $('capiValor').value    = '';
    $('capiNome').value     = chumboAtivo.nome     || '';
    $('capiEmail').value    = chumboAtivo.email    || '';
    $('capiCpf').value      = chumboAtivo.cpf      || '';
    $('capiEndereco').value = chumboAtivo.endereco || '';
    $('capiCidade').value   = chumboAtivo.cidade
        ? (chumboAtivo.estado ? `${chumboAtivo.cidade} - ${chumboAtivo.estado}` : chumboAtivo.cidade)
        : '';
    $('capiModal').classList.add('open');
    lucide.createIcons({ nodes: [$('capiModal')] });
}
function fecharModal() { $('capiModal').classList.remove('open'); chumboAtivo = null; }
$('capiModal').addEventListener('click', e => { if(e.target === $('capiModal')) fecharModal(); });

async function sha256(msg) {
    if (!msg) return '';
    const buf  = new TextEncoder().encode(msg.trim().toLowerCase());
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function confirmarVenda() {
    if (!chumboAtivo) return;
    const valor = parseFloat($('capiValor').value);
    if (!valor || valor <= 0) { toast('Informe o valor da venda', 'error'); return; }

    const btn = $('btnConfirmarCapi');
    const originalLabel = btn.textContent;
    btn.textContent = 'Enviando CAPI...'; btn.disabled = true;

    try {
        const cidadeRaw = $('capiCidade').value.trim();
        const cidadeF   = cidadeRaw.includes(' - ') ? cidadeRaw.split(' - ')[0].trim() : cidadeRaw;
        const estado    = cidadeRaw.includes(' - ') ? cidadeRaw.split(' - ')[1].trim() : '';

        const r = await authFetch('/api/leads-update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id:          chumboAtivo.id,
                status:      'Vendido',
                valor_venda: valor,
                produto:     $('capiProduto').value.trim()  || undefined,
                nome:        $('capiNome').value.trim()     || undefined,
                email:       $('capiEmail').value.trim()    || undefined,
                cpf:         $('capiCpf').value.trim()      || undefined,
                cidade:      cidadeF                         || undefined,
                estado:      estado                          || undefined,
                endereco:    $('capiEndereco').value.trim()  || undefined,
            })
        });
        const result = await r.json();
        if (!r.ok || result.error) throw new Error(result.error || 'Erro ao registrar venda');

        // Atualizar localmente sem recarregar
        const idx = rawData.findIndex(l => l.id === chumboAtivo.id);
        if (idx !== -1) { rawData[idx].status = 'Vendido'; rawData[idx].valor_venda = valor; }
        aplicarFiltros();
        toast('Venda registrada e CAPI enviado para a Meta!', 'success');
        fecharModal();
    } catch(e) {
        toast('Erro: ' + e.message, 'error');
    } finally {
        btn.textContent = originalLabel; btn.disabled = false;
    }
}
