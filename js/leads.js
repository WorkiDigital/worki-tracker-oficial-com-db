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

        let url = '/api/leads';
        const params = new URLSearchParams();
        if (typeof clienteAdminSelecionado !== 'undefined' && clienteAdminSelecionado) {
            params.append('cliente_id', clienteAdminSelecionado);
        }
        const periodo = $('periodoSelect')?.value || 'hojeOntem';
        const range = (periodo && periodo !== 'todos') ? calcRange(periodo) : null;
        if (range) {
            params.append('start', range[0].toISOString());
            params.append('end', range[1].toISOString());
        }

        const resp = await authFetch(url + '?' + params.toString());
        const data = await readApiJson(resp, 'Falha ao buscar leads');
        if (!Array.isArray(data)) throw new Error(data.error || 'Resposta inesperada do servidor');
        rawData = data;
        // Registra qual período está de fato em rawData (usado por onPeriodoChange p/ decidir
        // se pode refiltrar a memória ou precisa rebuscar).
        window._periodoCarregado = periodo;
        popularFiltroInstancias();
        aplicarFiltros();

        const agora = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
        dot.className   = 'refresh-dot';
        label.textContent = `atualizado ${agora}`;
    } catch(e) {
        dot.className   = 'refresh-dot';
        // Queda de rede (offline) num refresh silencioso: mostra "sem conexão"
        // discreto e não dispara toast nem trata como erro grave do app.
        const offline = navigator.onLine === false || /Failed to fetch|NetworkError|ERR_INTERNET/i.test(e.message || '');
        if (offline) {
            dot.style.background = 'var(--amber)';
            label.textContent = 'sem conexão';
        } else {
            dot.style.background = 'var(--red)';
            label.textContent = 'erro ao carregar';
            if (!silencioso) toast(e.message, 'error');
        }
    } finally {
        if (icon) icon.style.animation = '';
        lucide.createIcons({ nodes: [icon?.parentElement].filter(Boolean) });
    }
}

async function carregarMetricasTemporais() {
    try {
        const periodo = $('periodoSelect')?.value || 'hojeOntem';
        const range = (periodo && periodo !== 'todos') ? calcRange(periodo) : null;
        
        let url = '/api/metrics-temporal?';
        const params = new URLSearchParams();
        
        if (clienteAdminSelecionado) params.append('cliente_id', clienteAdminSelecionado);
        if (range) {
            params.append('start', range[0].toISOString());
            params.append('end', range[1].toISOString());
        }

        const response = await authFetch(url + params.toString());
        const data = await readApiJson(response, 'Falha ao carregar métricas temporais');

        // Ciclo médio: usa o rótulo formatado pelo backend (h/min/dias conforme a escala).
        if ($('avgCycleDays')) $('avgCycleDays').textContent = data.avgCycleLabel?.value ?? data.avgCycleDays;
        if ($('avgCycleLabel') && data.avgCycleLabel?.unit) $('avgCycleLabel').textContent = data.avgCycleLabel.unit;
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
// Períodos curtos que vêm juntos no carregamento "hojeOntem" — podem ser recortados
// da memória sem nova requisição, desde que o conjunto base seja hoje+ontem.
const PERIODOS_LOCAIS = ['hoje', 'ontem', 'hojeOntem'];

function onPeriodoChange() {
    const v = $('periodoSelect').value;
    $('areaPersonalizada').style.display = v === 'personalizado' ? 'flex' : 'none';
    if (v === 'personalizado') return; // só recarrega no botão OK

    // Se o período pedido é hoje/ontem E o que está carregado também é curto (hoje+ontem),
    // basta refiltrar a memória — troca instantânea, sem ir ao backend.
    if (PERIODOS_LOCAIS.includes(v) && PERIODOS_LOCAIS.includes(window._periodoCarregado)) {
        aplicarFiltros();
        return;
    }
    // Períodos maiores (ou vindo de um período maior) rebuscam do backend (dados frescos).
    recarregarLeads();
}

function calcRange(periodo) {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);
    if (periodo === 'hoje')   return [hoje, amanha];
    if (periodo === 'ontem')  { const d=new Date(hoje); d.setDate(d.getDate()-1); return [d, hoje]; }
    if (periodo === 'hojeOntem') { const d=new Date(hoje); d.setDate(d.getDate()-1); return [d, amanha]; }
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

// Range do período ANTERIOR com a mesma duração do range atual (deslocado para trás).
// Ex: período de 7 dias → os 7 dias imediatamente anteriores.
function calcRangePrevio(range) {
    if (!range) return null;
    const [ini, fim] = range;
    const duracao = fim.getTime() - ini.getTime();
    return [new Date(ini.getTime() - duracao), new Date(ini.getTime())];
}

function aplicarFiltros() {
    const busca   = ($('inputBusca').value||'').toLowerCase().trim();
    const periodo = $('periodoSelect')?.value || 'hojeOntem';
    const range = (periodo && periodo !== 'todos') ? calcRange(periodo) : null;
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
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted);">Nenhum lead encontrado.</td></tr>`;
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
        const temCapi  = true; // O backend busca o pixel do cliente via banco de dados 
        const data     = tempoRelativo(lead.event_time||lead.created_at);
        
        // FASE 2: Lead Score
        const score = lead.lead_score || 0;
        const scoreCls = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
        const scoreColor = score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#6b7280';

        // Tempo no Funil
        const tempoFunil = tempoRelativo(lead.created_at || lead.event_time);

        // Campanha / Conjunto / Anúncio
        const campanha = lead.utm_campaign || '—';
        const conjunto = lead.utm_medium   || '';
        const anuncio  = lead.utm_content  || '';
        const tooltipOrig = [
          campanha !== '—' ? `📣 ${campanha}` : '',
          conjunto ? `🗂 ${conjunto}` : '',
        ].filter(Boolean).join('\n');

        return `<tr>
            <td style="color:var(--text);font-weight:600;">${esc(lead.nome)||'N/A'}</td>
            <td>${esc(lead.telefone)||'N/A'}</td>
            <td><span class="tag" style="color:${stColor};border:${stBorder};">${esc(status)}</span></td>
            <td><span style="font-weight:700;color:${scoreColor};">${score}</span></td>
            <td style="max-width:160px;" title="${esc(tooltipOrig)}">
                ${anuncio ? `<div style="font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(anuncio)}</div>` : `<div style="font-size:11px;color:var(--muted);">—</div>`}
            </td>
            <td title="${esc(lead.mensagem_recebida)}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${esc(msg)}${lead.mensagem_recebida?.length>35?'…':''}</td>
            <td style="font-size:12px;color:var(--muted);">${esc(lead.instancia||'—')}</td>
            <td><div class="platform-icon ${platCls}">${esc(lead.plataforma||'instagram')}</div></td>
            <td title="${esc(lead.event_time)}" style="white-space:nowrap;">${data}</td>
            <td style="font-size:11px;font-weight:600;">${tempoFunil}</td>
            <td style="white-space:nowrap;"><div style="display:inline-flex;gap:4px;align-items:center;">
                <button class="btn btn-sm" onclick="abrirPerfilLead(${lead.id})" title="Ver perfil completo do lead" style="background:rgba(99,102,241,0.1);color:#6366f1;border:1px solid rgba(99,102,241,0.3);padding:2px 8px;display:inline-flex;align-items:center;justify-content:center;"><i data-lucide="user" style="width:12px;"></i></button>
                ${temCapi ? `<button class="btn btn-sm" style="background:rgba(59, 130, 246, 0.1);color:#3b82f6;border:1px solid rgba(59,130,246,0.3);padding:2px 8px;display:inline-flex;align-items:center;justify-content:center;" onclick="qualificarLead(${idx})" title="Marcar como Qualificado e enviar para CAPI"><i data-lucide="check-circle" style="width:12px;"></i></button><button class="btn btn-green btn-sm" onclick="abrirModal(${idx})" title="Registrar Venda e CAPI" style="margin:0;"><i data-lucide="zap" style="width:11px;"></i> Venda</button>` : ''}
            </div></td>
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
// Calcula as métricas-chave de um conjunto de leads (reutilizado no período atual e no anterior).
function calcMetricasRelatorio(leads) {
    const total  = leads.length;
    const vendas = leads.filter(l => (l.status||'').toLowerCase() === 'vendido');
    const qualificados = leads.filter(l =>
        (l.status||'').toLowerCase() === 'qualificado' || l.qualified_at
    );
    const receita = vendas.reduce((s,l) => s + parseFloat(l.valor_venda||0), 0);
    const conv    = total ? (vendas.length/total)*100 : 0;
    return { total, vendas: vendas.length, qualificados: qualificados.length, receita, conv };
}

function renderRelatorios() {
    const total  = dadosFiltrados.length;
    const vendas = dadosFiltrados.filter(l => (l.status||'').toLowerCase() === 'vendido');
    // Qualificados: status "Qualificado" OU que já passaram pela qualificação (qualified_at).
    const qualificados = dadosFiltrados.filter(l =>
        (l.status||'').toLowerCase() === 'qualificado' || l.qualified_at
    );
    const receita = vendas.reduce((s,l) => s + parseFloat(l.valor_venda||0), 0);
    const conv   = total ? ((vendas.length/total)*100).toFixed(1) : 0;

    $('val-total').textContent   = total;
    $('val-vendas').textContent  = vendas.length;
    if ($('val-qualificados')) $('val-qualificados').textContent = qualificados.length;
    $('val-conv').textContent    = conv + '%';
    $('val-receita').textContent = brl(receita);

    // Comparação vs período anterior (busca leve, não bloqueia o render principal).
    renderComparativoPeriodo();

    const mapCamp = agrupar(dadosFiltrados, 'utm_campaign');
    const mapAdset = agrupar(dadosFiltrados, 'utm_medium');
    const mapA  = agrupar(dadosFiltrados, 'utm_content');
    const mapP  = agrupar(dadosFiltrados, 'plataforma');
    const mapAV = agrupar(vendas, 'utm_content');
    const mapPV = agrupar(vendas, 'plataforma');

    criarGrafico('cCampLeads','lCampLeads', mapCamp, 'bar');
    criarGrafico('cAdsetLeads','lAdsetLeads', mapAdset, 'bar');
    criarGrafico('c1','l1',mapA,'doughnut');
    criarGrafico('c2','l2',mapP,'doughnut');
    criarGrafico('c3','l3',mapAV,'bar');
    criarGrafico('c4','l4',mapPV,'doughnut');
    
    // NOVO: Gráfico de Linha do Tempo
    renderTimelineChart();
    
    // NOVO: Heatmap de Horários
    renderHeatmap(window.currentHeatmapTipo || 'leads');
}

// Busca os leads do período anterior e renderiza a variação (+/-%) em cada card.
async function renderComparativoPeriodo() {
    const periodo = $('periodoSelect')?.value || 'hojeOntem';
    const range = (periodo && periodo !== 'todos') ? calcRange(periodo) : null;
    const prev = calcRangePrevio(range);
    if (!prev) { limparComparativo(); return; } // "Todos" não tem período anterior definido

    try {
        const params = new URLSearchParams();
        if (typeof clienteAdminSelecionado !== 'undefined' && clienteAdminSelecionado) {
            params.append('cliente_id', clienteAdminSelecionado);
        }
        params.append('start', prev[0].toISOString());
        params.append('end', prev[1].toISOString());

        const resp = await authFetch('/api/leads?' + params.toString());
        if (!resp.ok) { limparComparativo(); return; }
        const leadsPrev = await resp.json();
        if (!Array.isArray(leadsPrev)) { limparComparativo(); return; }

        const atual = calcMetricasRelatorio(dadosFiltrados);
        const ant   = calcMetricasRelatorio(leadsPrev);

        setDelta('delta-total',        atual.total,        ant.total);
        setDelta('delta-vendas',       atual.vendas,       ant.vendas);
        setDelta('delta-qualificados', atual.qualificados, ant.qualificados);
        setDelta('delta-conv',         atual.conv,         ant.conv);
        setDelta('delta-receita',      atual.receita,      ant.receita);
    } catch (e) {
        console.error('Comparativo de período falhou:', e);
        limparComparativo();
    }
}

// Renderiza a seta + percentual de variação num elemento de delta.
function setDelta(elId, atual, anterior) {
    const el = $(elId);
    if (!el) return;
    if (anterior === 0) {
        // Sem base de comparação: mostra "novo" se há valor agora, senão nada.
        el.innerHTML = atual > 0 ? '<span style="color:var(--green);">novo</span>' : '';
        return;
    }
    const variacao = ((atual - anterior) / anterior) * 100;
    const subiu = variacao >= 0;
    const cor = variacao === 0 ? 'var(--muted)' : (subiu ? 'var(--green)' : 'var(--red)');
    const seta = variacao === 0 ? '→' : (subiu ? '▲' : '▼');
    el.innerHTML = `<span style="color:${cor};font-size:11px;font-weight:600;">${seta} ${Math.abs(variacao).toFixed(0)}%</span>`;
}

function limparComparativo() {
    ['delta-total','delta-vendas','delta-qualificados','delta-conv','delta-receita']
        .forEach(id => { if ($(id)) $(id).innerHTML = ''; });
}

// Exporta a aba Relatórios como PDF (html2canvas + jsPDF, ambos via CDN deferida).
async function exportarRelatorioPDF() {
    const alvo = $('relatorioConteudo');
    const btn  = $('btnExportRelatorio');
    if (!alvo) return;
    if (typeof html2canvas === 'undefined' || !window.jspdf) {
        toast('Bibliotecas de exportação ainda carregando, tente novamente', 'error');
        return;
    }

    const labelOriginal = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando PDF...'; }

    // Força o tema CLARO durante a captura para o texto ficar legível (escuro sobre branco).
    // Sem isso, o dark mode gera texto claro sobre fundo branco = ilegível.
    const eraDark = !document.documentElement.classList.contains('light');
    if (eraDark) {
        document.documentElement.classList.add('light');
        // Redesenha gráficos/heatmap no tema claro (Chart.js fixa cores na criação).
        if (typeof renderRelatorios === 'function') renderRelatorios();
    }
    // Aguarda o repaint do tema + os gráficos do Chart.js reagirem.
    await new Promise(r => setTimeout(r, 400));

    try {
        const canvas = await html2canvas(alvo, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true
        });

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const imgW = pageW;

        // Cabeçalho com nome do projeto e período.
        const periodoLabel = $('periodoSelect')?.options[$('periodoSelect').selectedIndex]?.text || '';
        const projeto = $('nome-projeto')?.textContent || 'Relatório';
        pdf.setFontSize(14);
        pdf.text(`${projeto} — Relatório`, 10, 12);
        pdf.setFontSize(10);
        pdf.text(`Período: ${periodoLabel}  ·  Gerado em ${new Date().toLocaleDateString('pt-BR')}`, 10, 18);

        const topo = 24;
        const dispW = imgW - 20;            // margem lateral de 10mm
        const dispH = (canvas.height * dispW) / canvas.width;

        // Se couber numa página, insere direto; senão, fatia em múltiplas páginas.
        if (dispH <= pageH - topo - 10) {
            pdf.addImage(canvas, 'PNG', 10, topo, dispW, dispH);
        } else {
            let restante = dispH;
            let posY = topo;
            let sliceTop = 0;
            const ratio = canvas.width / dispW; // px por mm
            while (restante > 0) {
                const espaco = pageH - posY - 10;
                const sliceH = Math.min(espaco, restante);
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = sliceH * ratio;
                sliceCanvas.getContext('2d').drawImage(
                    canvas, 0, sliceTop * ratio, canvas.width, sliceH * ratio,
                    0, 0, canvas.width, sliceH * ratio
                );
                pdf.addImage(sliceCanvas, 'PNG', 10, posY, dispW, sliceH);
                restante -= sliceH;
                sliceTop += sliceH;
                if (restante > 0) { pdf.addPage(); posY = 10; }
            }
        }

        pdf.save(`relatorio-${new Date().toISOString().slice(0,10)}.pdf`);
        toast('Relatório exportado em PDF', 'success');
    } catch (e) {
        console.error('Erro ao exportar PDF:', e);
        toast('Erro ao gerar PDF: ' + e.message, 'error');
    } finally {
        // Restaura o tema escuro se ele estava ativo antes da exportação.
        if (eraDark) {
            document.documentElement.classList.remove('light');
            if (typeof renderRelatorios === 'function') renderRelatorios(); // re-renderiza gráficos no tema original
        }
        if (btn) { btn.disabled = false; btn.innerHTML = labelOriginal; lucide.createIcons({ nodes:[btn] }); }
    }
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
            let num = '';
            if (val > 0) {
                const intensity = maxVal > 1 ? 0.2 + (0.8 * (val / maxVal)) : 1.0;
                bg = `rgba(14, 165, 233, ${intensity.toFixed(2)})`;
                // Texto branco em célula mais escura, escuro (tema) em célula clara.
                const txtColor = intensity >= 0.55 ? '#fff' : 'var(--text)';
                num = `<span class="heatmap-num" style="color:${txtColor};">${val}</span>`;
            }
            const tooltip = val === 1 ? `1 ${tipo.slice(0,-1)} às ${h}h (${dias[d]})` : `${val} ${tipo} às ${h}h (${dias[d]})`;
            html += `<div class="heatmap-cell" style="background:${bg};" data-tooltip="${tooltip}">${num}</div>`;
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

    // Trunca labels longos para o eixo X, mantém o nome completo no tooltip
    const truncar = (s, n=22) => s.length > n ? s.substring(0, n) + '…' : s;
    const labelsShort = labels.map(l => truncar(l));

    const cfg = tipo === 'bar' ? {
        type:'bar',
        data:{ labels: labelsShort, datasets:[{ data:values, backgroundColor:CORES, borderRadius:6, borderSkipped:false }] },
        options:{ responsive:true, maintainAspectRatio:false,
            plugins:{
                legend:{display:false},
                datalabels:{display:false},
                tooltip:{ callbacks:{ title: (items) => labels[items[0].dataIndex] } }
            },
            scales:{ x:{ticks:{color:tickC,font:{size:9},maxRotation:30,minRotation:0},grid:{display:false}}, y:{ticks:{color:tickC},grid:{color:gridC}} } }
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
                <div class="legend-left"><div class="legend-dot" style="background:${CORES[i%CORES.length]};"></div><span>${esc(l)}</span></div>
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

        // O lead foi salvo como Vendido no banco. O toast reflete o resultado real do envio à Meta.
        if (result.capi && result.capi.sent === false) {
            toast('Não foi enviado para a Meta, mas foi salvo no banco', 'warning');
        } else {
            toast('Venda registrada e CAPI enviado para a Meta!', 'success');
        }
        fecharModal();
    } catch(e) {
        toast('Erro: ' + e.message, 'error');
    } finally {
        btn.textContent = originalLabel; btn.disabled = false;
    }
}

let chumboQualificarId = null;

// ── Qualificação Rápida ────────────────────────────────────────
// idx é índice em dadosFiltrados (mesma base usada na renderização da tabela e em abrirModal).
// Guardamos o id do lead (estável) em vez do índice, que muda quando a tabela re-renderiza.
function qualificarLead(idx) {
    const lead = dadosFiltrados[idx];
    if (!lead) return;

    chumboQualificarId = lead.id;
    $('modalQualificarNome').textContent = lead.nome || 'desconhecido';
    $('qualificarModal').classList.add('open');
}

async function confirmarQualificacao() {
    if (chumboQualificarId === null) return;
    const lead = rawData.find(l => l.id === chumboQualificarId);
    if (!lead) return;

    const btn = $('btnConfirmarQualificacao');
    const prevHtml = btn.innerHTML;
    btn.innerHTML = '...'; 
    btn.disabled = true;

    try {
        const r = await authFetch('/api/leads-update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: lead.id,
                status: 'Qualificado'
            })
        });
        const result = await r.json();
        if (!r.ok || result.error) throw new Error(result.error || 'Erro ao qualificar');

        lead.status = 'Qualificado';
        aplicarFiltros();

        // Lead salvo como Qualificado no banco. O toast reflete o resultado real do envio à Meta.
        if (result.capi && result.capi.sent === false) {
            toast('Não foi possível enviar para a Meta', 'error');
        } else {
            toast('Lead Qualificado! Evento enviado.', 'success');
        }
        $('qualificarModal').classList.remove('open');
    } catch(e) {
        toast('Erro: ' + e.message, 'error');
    } finally {
        btn.innerHTML = prevHtml;
        btn.disabled = false;
        chumboQualificarId = null;
    }
}

// ── Perfil do Lead (Drawer 4 abas) ────────────────────────────────────────────

let _lpTabAtual = 'perfil';
let _lpDados = null;

async function abrirPerfilLead(leadId) {
    const drawer = $('leadProfileDrawer');
    drawer.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Reset visual
    $('lpLoading').style.display = 'flex';
    ['perfil','anuncio','jornada','venda'].forEach(t => {
        $(`lpPainel-${t}`).style.display = 'none';
    });
    lpMudarTab('perfil', false);

    try {
        const r = await authFetch(`/api/lead-profile?id=${leadId}`);
        if (!r.ok) throw new Error('Erro ao buscar perfil');
        _lpDados = await r.json();
        $('lpLoading').style.display = 'none';
        lpPreencherDados(_lpDados);
        $(`lpPainel-perfil`).style.display = 'block';
        lucide.createIcons({ nodes: [drawer] });
    } catch(e) {
        $('lpLoading').innerHTML = `<span style="color:var(--muted)">Erro ao carregar: ${e.message}</span>`;
    }
}

function fecharPerfilLead() {
    $('leadProfileDrawer').style.display = 'none';
    document.body.style.overflow = '';
    _lpDados = null;
}

function lpMudarTab(tab, renderizar = true) {
    const abas = ['perfil','anuncio','jornada','venda'];
    abas.forEach(t => {
        const btn = $(`lpTab-${t}`);
        if (!btn) return;
        if (t === tab) {
            btn.style.color = '#3b82f6';
            btn.style.borderBottom = '2px solid #3b82f6';
        } else {
            btn.style.color = 'var(--muted)';
            btn.style.borderBottom = '2px solid transparent';
        }
        if (renderizar) $(`lpPainel-${t}`).style.display = t === tab ? 'block' : 'none';
    });
    _lpTabAtual = tab;
    if (renderizar && _lpDados) lucide.createIcons({ nodes: [$('leadProfileDrawer')] });
}

function lpRow(label, valor, cor) {
    if (!valor || valor === '—') return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;"><span style="font-size:12px;color:var(--muted);flex-shrink:0;">${label}</span><span style="font-size:13px;color:var(--muted);font-style:italic;">—</span></div>`;
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;"><span style="font-size:12px;color:var(--muted);flex-shrink:0;">${label}</span><span style="font-size:13px;color:${cor||'var(--text-primary)'};font-weight:500;text-align:right;word-break:break-word;">${valor}</span></div>`;
}

function lpFormatDuracao(minutos) {
    if (!minutos || minutos <= 0) return null;
    if (minutos < 60) return `${Math.round(minutos)} min`;
    if (minutos < 1440) return `${(minutos/60).toFixed(1)} h`;
    return `${(minutos/1440).toFixed(1)} dias`;
}

function lpFormatData(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function lpPreencherDados({ lead, jornada }) {
    // ── Header ──
    const inicial = (lead.nome || '?')[0].toUpperCase();
    $('lpAvatar').textContent = inicial;
    $('lpNome').textContent = lead.nome || 'Sem nome';
    $('lpTelefone').textContent = lead.telefone || '—';
    const status = (lead.status || 'lead');
    const isVendido = status.toLowerCase() === 'vendido' || status.toLowerCase() === 'venda_fechada';
    const isQualif = status.toLowerCase() === 'qualificado';
    const badgeColor = isVendido ? '#10b981' : isQualif ? '#6366f1' : 'var(--muted)';
    const badgeBg = isVendido ? 'rgba(16,185,129,.12)' : isQualif ? 'rgba(99,102,241,.12)' : 'var(--bg-secondary)';
    $('lpStatusBadge').textContent = status;
    $('lpStatusBadge').style.color = badgeColor;
    $('lpStatusBadge').style.background = badgeBg;
    $('lpStatusBadge').style.borderColor = isVendido ? 'rgba(16,185,129,.3)' : isQualif ? 'rgba(99,102,241,.3)' : 'var(--border)';

    // ── Aba Perfil ──
    $('lpRowNome').innerHTML     = lpRow('Nome completo', lead.nome);
    $('lpRowTel').innerHTML      = lpRow('Telefone', lead.telefone);
    $('lpRowEmail').innerHTML    = lpRow('E-mail', lead.email);
    $('lpRowCpf').innerHTML      = lpRow('CPF', lead.cpf);
    $('lpRowEndereco').innerHTML = lpRow('Endereço', [lead.endereco, lead.cidade, lead.estado].filter(Boolean).join(', ') || null);
    $('lpRowStatus').innerHTML   = lpRow('Status', status, badgeColor);
    const scoreVal = lead.lead_score || 0;
    const scoreCor = scoreVal >= 70 ? '#ef4444' : scoreVal >= 40 ? '#f59e0b' : '#6b7280';
    $('lpRowScore').innerHTML    = lpRow('Lead Score', scoreVal ? `${scoreVal} pts` : null, scoreCor);
    $('lpRowInstancia').innerHTML = lpRow('Instância', lead.instancia);
    $('lpRowPlataforma').innerHTML = lpRow('Plataforma', lead.plataforma);
    $('lpRowEntrada').innerHTML  = lpRow('Data de entrada', lpFormatData(lead.created_at));
    $('lpMensagem').textContent  = lead.mensagem_recebida || '—';

    // ── Aba Anúncio ──
    $('lpRowCampanha').innerHTML  = lpRow('Campanha', lead.utm_campaign, '#3b82f6');
    $('lpRowConjunto').innerHTML  = lpRow('Conjunto', lead.utm_medium, '#6366f1');
    $('lpRowAnuncio').innerHTML   = lpRow('Anúncio', lead.utm_content);
    $('lpRowPlat').innerHTML      = lpRow('Plataforma', lead.plataforma);
    $('lpRowCtwa').innerHTML      = lpRow('CTWA Click ID', lead.ctw_aci_id ? lead.ctw_aci_id.substring(0,24)+'…' : null);
    $('lpRowSourceId').innerHTML  = lpRow('Source ID (Anúncio)', lead.source_id);
    $('lpRowPageId').innerHTML    = lpRow('Page ID', lead.page_id);

    // ── Aba Jornada ──
    const total = jornada.length;
    $('lpJornadaResumo').innerHTML = `<strong style="color:var(--text-primary);">${total} contato${total !== 1 ? 's' : ''}</strong> registrado${total !== 1 ? 's' : ''} via anúncio para este número.`;
    $('lpTimeline').innerHTML = jornada.map((j, i) => {
        const isCurrent = j.id === lead.id;
        const isV = (j.status||'').toLowerCase() === 'vendido' || (j.status||'').toLowerCase() === 'venda_fechada';
        const dotColor = isV ? '#10b981' : isCurrent ? '#3b82f6' : 'var(--muted)';
        const linhaAds = [j.utm_content, j.utm_medium, j.utm_campaign].filter(Boolean);
        return `<div style="display:flex;gap:14px;margin-bottom:${i < jornada.length-1 ? '0' : '0'};">
            <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
                <div style="width:12px;height:12px;border-radius:50%;background:${dotColor};border:2px solid ${dotColor};margin-top:3px;flex-shrink:0;${isCurrent?'box-shadow:0 0 0 3px rgba(59,130,246,.2)':''}"></div>
                ${i < jornada.length-1 ? `<div style="width:2px;flex:1;background:var(--border);margin:4px 0;min-height:30px;"></div>` : ''}
            </div>
            <div style="padding-bottom:20px;flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
                    <span style="font-size:12px;font-weight:700;color:var(--text-primary);">${i+1}º contato</span>
                    ${isCurrent ? `<span style="font-size:10px;background:rgba(59,130,246,.1);color:#3b82f6;padding:1px 7px;border-radius:10px;border:1px solid rgba(59,130,246,.2);">atual</span>` : ''}
                    <span style="font-size:11px;color:var(--muted);margin-left:auto;">${lpFormatData(j.created_at)}</span>
                </div>
                <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:5px;">
                    ${linhaAds.length ? `
                        ${j.utm_content  ? `<div style="font-size:12px;"><span style="color:var(--muted);">🎯 Anúncio: </span><span style="color:var(--text-primary);font-weight:500;">${esc(j.utm_content)}</span></div>` : ''}
                        ${j.utm_medium   ? `<div style="font-size:12px;"><span style="color:var(--muted);">🗂 Conjunto: </span><span style="color:#6366f1;font-weight:500;">${esc(j.utm_medium)}</span></div>` : ''}
                        ${j.utm_campaign ? `<div style="font-size:12px;"><span style="color:var(--muted);">📣 Campanha: </span><span style="color:#3b82f6;font-weight:500;">${esc(j.utm_campaign)}</span></div>` : ''}
                    ` : `<div style="font-size:12px;color:var(--muted);">Sem dados de anúncio</div>`}
                    <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
                        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:${isV?'#10b981':'var(--muted)'};">${j.status||'Lead'}</span>
                        ${j.valor_venda ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);color:#10b981;">💰 R$ ${parseFloat(j.valor_venda).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>` : ''}
                        ${j.plataforma ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:var(--muted);">${j.plataforma}</span>` : ''}
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');

    // ── Aba Venda ──
    const diffResposta = lead.first_response_at && lead.created_at
        ? (new Date(lead.first_response_at) - new Date(lead.created_at)) / 60000 : null;
    const diffCiclo = lead.sale_closed_at && lead.created_at
        ? (new Date(lead.sale_closed_at) - new Date(lead.created_at)) / 60000 : null;

    $('lpCardResposta').textContent = lpFormatDuracao(diffResposta) || '—';
    $('lpCardCiclo').textContent    = lpFormatDuracao(diffCiclo) || '—';
    $('lpRowStatusVenda').innerHTML = lpRow('Status', status, badgeColor);
    $('lpRowValor').innerHTML       = lpRow('Valor da venda', lead.valor_venda ? `R$ ${parseFloat(lead.valor_venda).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : null, '#10b981');
    $('lpRowProduto').innerHTML     = lpRow('Produto', lead.produto);
    $('lpRowDataVenda').innerHTML   = lpRow('Data da venda', lpFormatData(lead.sale_closed_at));
    $('lpRowQualificado').innerHTML = lpRow('Qualificado em', lpFormatData(lead.qualified_at));
    $('lpSemVenda').style.display   = isVendido ? 'none' : 'block';
}

