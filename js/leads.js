// ── Leads (extracted from index.html) ──────────────────────────
let chumboAtivo = null;
const leadsSelecionados = new Set();
const LEADS_VIEW_MODE_KEY = 'wt_leads_view_mode';
const LEADS_VIEW_MODES = new Set(['lista', 'kanban']);
const LEAD_KANBAN_COLUMNS = [
    { key:'lead', label:'Lead', status:'Lead', tone:'neutral' },
    { key:'qualificado', label:'Qualificado', status:'Qualificado', tone:'blue' },
    { key:'agendado', label:'Agendado', status:'Agendado', tone:'amber' },
    { key:'vendido', label:'Vendido', status:'Vendido', tone:'green' },
    { key:'perdido', label:'Perdido', status:'Perdido', tone:'red' },
];

function leadClienteAdminAtual() {
    if (typeof clienteAdminSelecionado === 'undefined' || !clienteAdminSelecionado) return null;
    const n = Number(clienteAdminSelecionado);
    return Number.isFinite(n) ? n : null;
}

function leadPertenceAoCliente(lead, clienteId) {
    if (!clienteId) return true;
    return Number(lead?.cliente_id) === Number(clienteId);
}
// Cache de leads por chave "clienteId|periodo" — evita piscar ao navegar entre abas.
const _leadsCache = new MemCache(2 * 60 * 1000); // TTL 2 min (auto-refresh de 30s mantém fresco)

async function recarregarLeads(silencioso = false) {
    const dot   = $('refreshDot');
    const label = $('refreshLabel');
    dot.className   = 'refresh-dot loading';
    label.textContent = silencioso ? 'atualizando...' : 'carregando...';

    const icon = $('reloadIcon');
    if (icon) icon.style.animation = 'spin 1s linear infinite';

    const periodo = $('periodoSelect')?.value || 'hojeOntem';
    const clienteId = leadClienteAdminAtual();
    const clienteKey = clienteId || 'me';
    const cacheKey = `${clienteKey}|${periodo}`;

    // Serve cache imediatamente (sem skeleton) — evita piscar ao trocar de aba.
    const cached = _leadsCache.get(cacheKey);
    if (cached && !silencioso) {
        rawData = cached;
        window._periodoCarregado = periodo;
        popularFiltroInstancias();
        aplicarFiltros();
        dot.className = 'refresh-dot';
        label.textContent = 'do cache';
        if (icon) icon.style.animation = '';
        // Revalida em background sem skeleton nem spinner
        _recarregarLeadsFetch(cacheKey, periodo, true).catch(() => {});
        return;
    }

    if (!silencioso) renderSkeleton();

    await _recarregarLeadsFetch(cacheKey, periodo, silencioso);
}

async function _recarregarLeadsFetch(cacheKey, periodo, silencioso) {
    const dot   = $('refreshDot');
    const label = $('refreshLabel');
    const icon  = $('reloadIcon');
    try {
        // Dispara a fase 3 (métricas) em paralelo, não bloqueia a tabela
        carregarMetricasTemporais();

        let url = '/api/leads';
        const params = new URLSearchParams();
        const clienteId = leadClienteAdminAtual();
        if (clienteId) params.append('cliente_id', clienteId);
        const range = (periodo && periodo !== 'todos') ? calcRange(periodo) : null;
        if (range) {
            params.append('start', range[0].toISOString());
            params.append('end', range[1].toISOString());
        }

        const resp = await authFetch(url + '?' + params.toString());
        const data = await readApiJson(resp, 'Falha ao buscar leads');
        if (!Array.isArray(data)) throw new Error(data.error || 'Resposta inesperada do servidor');
        _leadsCache.set(cacheKey, data);
        rawData = data;
        const idsAtuais = new Set(rawData.map(lead => Number(lead.id)));
        for (const id of leadsSelecionados) {
            if (!idsAtuais.has(id)) leadsSelecionados.delete(id);
        }
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
            // mensagemErro (global, index.html) dá texto específico por tipo de falha.
            if (!silencioso) toast(typeof mensagemErro === 'function' ? mensagemErro(e) : e.message, 'error');
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
        
        const clienteId = leadClienteAdminAtual();
        if (clienteId) params.append('cliente_id', clienteId);
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
            ${Array.from({length:13}, () => `<td><div class="sk-line skeleton" style="width:${60+Math.random()*40}%"></div></td>`).join('')}
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

    // Só dá pra refiltrar a memória (instantâneo) se o que ESTÁ carregado é
    // 'hojeOntem' — o único período que traz hoje E ontem juntos em rawData.
    // Se a memória tem só um dia (carregou 'hoje' OU 'ontem'), trocar para o outro
    // dia precisa REBUSCAR — senão refiltra sobre dados que não existem e some tudo.
    if (PERIODOS_LOCAIS.includes(v) && window._periodoCarregado === 'hojeOntem') {
        aplicarFiltros();
        return;
    }
    // Demais casos rebuscam do backend (dados frescos e completos).
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
    const origemFiltro = ($('selectOrigem')?.value || '');

    dadosFiltrados = rawData.filter(l => {
        const clienteId = leadClienteAdminAtual();
        if (!leadPertenceAoCliente(l, clienteId)) return false;

        // Filtro por instância
        if (instanciaFiltro && l.instancia !== instanciaFiltro) return false;

        // Filtro por origem (ctwa/organic). Leads antigos sem lead_origin = ctwa.
        if (origemFiltro) {
            const orig = (l.lead_origin || 'ctwa').toLowerCase();
            if (orig !== origemFiltro) return false;
        }

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
    renderLeadsView();
    renderRelatorios(); // async — Chart.js carregado sob demanda dentro dela
    
    // Atualiza as métricas do topo (cards) baseadas no filtro atual
    carregarMetricasTemporais();
}

// ── Filtro de Instâncias ──────────────────────────────────────
function popularFiltroInstancias() {
    const sel = $('selectInstancia');
    if (!sel) return;

    const valorAtual = sel.value;
    
    // Filtra os leads pelo cliente selecionado antes de extrair instâncias únicas
    const clienteId = leadClienteAdminAtual();
    const leadsVisiveis = clienteId
        ? rawData.filter(l => leadPertenceAoCliente(l, clienteId))
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
 
    ['nome','status','event_time'].forEach(c => {
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
        const temBusca = (($('inputBusca')?.value || '').trim().length > 0);
        const msg = temBusca
            ? 'Nenhum lead corresponde à busca.'
            : 'Nenhum lead neste período.';
        const dica = temBusca
            ? 'Tente outro nome ou telefone.'
            : 'Ajuste o período no filtro acima ou aguarde novos contatos.';
        tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:48px 20px;color:var(--muted);">
            <i data-lucide="users-round" style="width:34px;height:34px;opacity:.4;display:block;margin:0 auto 12px;"></i>
            <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;">${msg}</div>
            <div style="font-size:12px;">${dica}</div>
        </td></tr>`;
        if (window.lucide) lucide.createIcons({ nodes: [tbody] });
        $('paginacao').innerHTML = '';
        atualizarSelecaoLeads();
        return;
    }

    tbody.innerHTML = pagina.map((lead, i) => {
        const idx      = inicio + i;
        const _utmSrc = (lead.utm_source || '').toLowerCase();
        const plataformaLabel = lead.plataforma ||
            (lead.lead_origin === 'campaign_link' || lead.lead_origin === 'bio' || lead.lead_origin === 'rotator'
                ? (_utmSrc.includes('fb') || _utmSrc.includes('face') ? 'facebook'
                   : _utmSrc.includes('ig') || _utmSrc.includes('insta') ? 'instagram'
                   : _utmSrc.includes('google') || _utmSrc.includes('adwords') ? 'google'
                   : 'whatsapp')
                : (lead.lead_origin && lead.lead_origin !== 'ctwa' ? 'whatsapp' : 'instagram'));
        const plat     = plataformaLabel.toLowerCase();
        const platCls  = plat.includes('face') ? 'facebook' : plat.includes('google') ? 'google' : plat.includes('whats') ? 'whatsapp' : 'instagram';
        const status   = (lead.status||'Lead').toLowerCase();
        const purchase = status === 'venda_fechada' || status === 'vendido';
        const agendado = status === 'agendado';
        const stColor  = purchase ? '#10b981' : agendado ? '#f59e0b' : '';
        const stBorder = purchase ? '1px solid rgba(16,185,129,.3)' : agendado ? '1px solid rgba(245,158,11,.3)' : 'transparent';
        const msg      = (lead.mensagem_recebida||'Sem mensagem').substring(0,35);
        const temCapi  = true; // O backend busca o pixel do cliente via banco de dados 
        const data     = tempoRelativo(lead.event_time||lead.created_at);

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

        const origemInfo = obterOrigemLead(lead.lead_origin);
        const origemBadge = `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:${origemInfo.bg};color:${origemInfo.color};border:1px solid ${origemInfo.border};white-space:nowrap;">${origemInfo.label}</span>`;

        return `<tr>
            <td style="text-align:center;">
                <input type="checkbox" class="lead-row-check" data-lead-id="${Number(lead.id)}"
                    ${leadsSelecionados.has(Number(lead.id)) ? 'checked' : ''}
                    onchange="toggleLeadSelecionado(${Number(lead.id)}, this.checked)"
                    aria-label="Selecionar ${esc(lead.nome || lead.telefone || 'lead')}">
            </td>
            <td data-label="Nome" style="color:var(--text);font-weight:600;">${esc(lead.nome)||'N/A'}</td>
            <td data-label="Telefone">${esc(lead.telefone)||'N/A'}</td>
            <td data-label="Status"><span class="tag" style="color:${stColor};border:${stBorder};">${esc(status)}</span></td>
            <td data-label="Anúncio" style="max-width:160px;" title="${esc(tooltipOrig)}">
                ${anuncio ? `<div style="font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(anuncio)}</div>` : `<div style="font-size:11px;color:var(--muted);">—</div>`}
            </td>
            <td data-label="Origem">${origemBadge}</td>
            <td data-label="Mensagem" title="${esc(lead.mensagem_recebida)}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${esc(msg)}${lead.mensagem_recebida?.length>35?'…':''}</td>
            <td data-label="Instância" style="font-size:12px;color:var(--muted);">${esc(lead.instancia||'—')}</td>
            <td data-label="Plataforma" style="text-align:center;"><div class="platform-icon ${platCls}" title="${esc(plataformaLabel)}">${_PLATFORM_ICONS[platCls] || ''}</div></td>
            <td data-label="Data" title="${esc(lead.event_time)}" style="white-space:nowrap;">${data}</td>
            <td data-label="Funil" style="font-size:11px;font-weight:600;">${tempoFunil}</td>
            <td style="white-space:nowrap;"><div style="display:inline-flex;gap:4px;align-items:center;">
                <button class="btn btn-sm" onclick="abrirPerfilLead(${lead.id})" title="Ver perfil completo do lead" style="background:rgba(99,102,241,0.1);color:#6366f1;border:1px solid rgba(99,102,241,0.3);padding:2px 8px;display:inline-flex;align-items:center;justify-content:center;"><i data-lucide="user" style="width:12px;"></i></button>
                <button class="btn btn-sm" onclick="abrirConversaDoLead(${lead.id})" title="Abrir conversa no WhatsApp" style="background:rgba(37,211,102,0.1);color:#128c4a;border:1px solid rgba(37,211,102,0.35);padding:2px 8px;display:inline-flex;align-items:center;justify-content:center;"><i data-lucide="message-circle" style="width:12px;"></i></button>
                ${temCapi ? `<button class="btn btn-sm" style="background:rgba(59, 130, 246, 0.1);color:#3b82f6;border:1px solid rgba(59,130,246,0.3);padding:2px 8px;display:inline-flex;align-items:center;justify-content:center;" onclick="qualificarLead(${idx})" title="Marcar como Qualificado e enviar para CAPI"><i data-lucide="check-circle" style="width:12px;"></i></button><button class="btn btn-green btn-sm" onclick="abrirModal(${idx})" title="Registrar Venda e CAPI" style="margin:0;"><i data-lucide="zap" style="width:11px;"></i> Venda</button>` : ''}
            </div></td>
        </tr>`;
    }).join('');

    lucide.createIcons({ nodes: [tbody] });
    atualizarSelecaoLeads();

    // Paginação
    const totalPags = Math.ceil(total / POR_PAGINA);
    renderPaginacao(totalPags, total, inicio);
}

function getLeadsViewMode() {
    try {
        const saved = localStorage.getItem(LEADS_VIEW_MODE_KEY);
        return LEADS_VIEW_MODES.has(saved) ? saved : 'lista';
    } catch (_) {
        return 'lista';
    }
}

function setLeadsViewMode(mode) {
    const next = LEADS_VIEW_MODES.has(mode) ? mode : 'lista';
    try { localStorage.setItem(LEADS_VIEW_MODE_KEY, next); } catch (_) {}
    renderLeadsView();
}

function updateLeadsViewToggle(mode = getLeadsViewMode()) {
    $('btnLeadsLista')?.classList.toggle('active', mode === 'lista');
    $('btnLeadsKanban')?.classList.toggle('active', mode === 'kanban');
}

function getLeadStatusKey(status) {
    const s = String(status || 'lead').trim().toLowerCase();
    if (['vendido', 'venda', 'venda_fechada'].includes(s)) return 'vendido';
    if (s === 'qualificado') return 'qualificado';
    if (s === 'agendado') return 'agendado';
    if (s === 'perdido') return 'perdido';
    return 'lead';
}

function renderLeadsView() {
    const mode = getLeadsViewMode();
    const tableWrap = $('leadsTableWrap');
    const kanbanWrap = $('leadsKanbanWrap');
    const pag = $('paginacao');
    updateLeadsViewToggle(mode);

    if (mode === 'kanban') {
        if (tableWrap) tableWrap.style.display = 'none';
        if (pag) pag.style.display = 'none';
        if (kanbanWrap) kanbanWrap.style.display = 'grid';
        renderKanban();
        return;
    }

    if (kanbanWrap) {
        kanbanWrap.style.display = 'none';
        kanbanWrap.innerHTML = '';
    }
    if (tableWrap) tableWrap.style.display = '';
    if (pag) pag.style.display = '';
    renderTabela();
}

function renderKanban() {
    const wrap = $('leadsKanbanWrap');
    if (!wrap) return;

    const total = dadosFiltrados.length;
    $('leadsCount').textContent = total;
    $('btnExport').style.display = 'flex';
    atualizarSelecaoLeads();

    if (!total) {
        const temBusca = (($('inputBusca')?.value || '').trim().length > 0);
        wrap.innerHTML = `<div class="kanban-empty">
            <i data-lucide="columns-3"></i>
            <strong>${temBusca ? 'Nenhum lead corresponde a busca.' : 'Nenhum lead neste periodo.'}</strong>
            <span>${temBusca ? 'Tente outro nome ou telefone.' : 'Ajuste o periodo ou aguarde novos contatos.'}</span>
        </div>`;
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        return;
    }

    wrap.innerHTML = LEAD_KANBAN_COLUMNS.map(col => {
        const leads = dadosFiltrados.filter(lead => getLeadStatusKey(lead.status) === col.key);
        return `<section class="kanban-column kanban-${col.tone}" data-status="${col.key}" ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event, '${col.key}')">
            <div class="kanban-column-head">
                <div><span class="kanban-dot"></span>${esc(col.label)}</div>
                <span>${leads.length}</span>
            </div>
            <div class="kanban-column-body">
                ${leads.length ? leads.map(renderKanbanCard).join('') : '<div class="kanban-column-empty">Sem leads</div>'}
            </div>
        </section>`;
    }).join('');

    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
}

function renderKanbanCard(lead) {
    const idx = dadosFiltrados.findIndex(l => Number(l.id) === Number(lead.id));
    const statusKey = getLeadStatusKey(lead.status);
    const origemInfo = obterOrigemLead(lead.lead_origin);
    const msg = (lead.mensagem_recebida || 'Sem mensagem').trim();
    const anuncio = lead.utm_content || lead.utm_campaign || 'Sem anuncio';
    const tempoFunil = tempoRelativo(lead.created_at || lead.event_time);

    return `<article class="kanban-card" draggable="true" data-lead-id="${Number(lead.id)}" ondragstart="kanbanDragStart(event, ${Number(lead.id)})" ondragend="kanbanDragEnd(event)">
        <div class="kanban-card-top">
            <button type="button" class="kanban-check" onclick="toggleKanbanLeadSelecionado(${Number(lead.id)})" title="Selecionar lead" aria-label="Selecionar lead">
                ${leadsSelecionados.has(Number(lead.id)) ? '<i data-lucide="check"></i>' : ''}
            </button>
            <div class="kanban-card-title" title="${esc(lead.nome || lead.telefone || 'Lead')}">${esc(lead.nome || 'Lead sem nome')}</div>
        </div>
        <div class="kanban-phone">${esc(lead.telefone || 'Telefone nao informado')}</div>
        <div class="kanban-chip-row">
            <span class="kanban-origin" style="background:${origemInfo.bg};color:${origemInfo.color};border-color:${origemInfo.border};">${origemInfo.label}</span>
            <span class="kanban-status-mini">${esc(LEAD_KANBAN_COLUMNS.find(c => c.key === statusKey)?.label || 'Lead')}</span>
        </div>
        <div class="kanban-message" title="${esc(msg)}">${esc(msg.substring(0, 92))}${msg.length > 92 ? '...' : ''}</div>
        <div class="kanban-meta">
            <span title="${esc(anuncio)}">${esc(anuncio)}</span>
            <strong>${tempoFunil}</strong>
        </div>
        <div class="kanban-actions">
            <button type="button" onclick="abrirPerfilLead(${Number(lead.id)})" title="Ver perfil"><i data-lucide="user"></i></button>
            <button type="button" onclick="abrirConversaDoLead(${Number(lead.id)})" title="Abrir conversa"><i data-lucide="message-circle"></i></button>
            <button type="button" onclick="qualificarLead(${idx})" title="Qualificar"><i data-lucide="check-circle"></i></button>
            <button type="button" class="sale" onclick="abrirModal(${idx})" title="Registrar venda"><i data-lucide="zap"></i><span>Venda</span></button>
        </div>
    </article>`;
}

function toggleKanbanLeadSelecionado(id) {
    const leadId = Number(id);
    toggleLeadSelecionado(leadId, !leadsSelecionados.has(leadId));
    renderKanban();
}
let kanbanDraggingLeadId = null;

function kanbanDragStart(event, leadId) {
    kanbanDraggingLeadId = Number(leadId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(leadId));
    event.currentTarget.classList.add('dragging');
}

function kanbanDragEnd(event) {
    event.currentTarget?.classList.remove('dragging');
    document.querySelectorAll('.kanban-column.drag-over').forEach(el => el.classList.remove('drag-over'));
    kanbanDraggingLeadId = null;
}

function kanbanDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
}

function kanbanDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('drag-over');
}

async function kanbanDrop(event, statusKey) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    const leadId = Number(event.dataTransfer.getData('text/plain') || kanbanDraggingLeadId);
    if (!leadId) return;
    await atualizarStatusLeadKanban(leadId, statusKey);
}

async function atualizarStatusLeadKanban(leadId, statusKey) {
    const lead = dadosFiltrados.find(l => Number(l.id) === Number(leadId));
    if (!lead) return;
    const atual = getLeadStatusKey(lead.status);
    if (atual === statusKey) return;

    const idx = dadosFiltrados.findIndex(l => Number(l.id) === Number(leadId));
    if (statusKey === 'vendido') {
        abrirModal(idx);
        return;
    }
    if (statusKey === 'qualificado') {
        qualificarLead(idx);
        return;
    }

    const col = LEAD_KANBAN_COLUMNS.find(c => c.key === statusKey) || LEAD_KANBAN_COLUMNS[0];
    const previousStatus = lead.status;
    lead.status = col.status;
    renderKanban();

    try {
        const r = await authFetch('/api/leads-update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: lead.id, status: col.status })
        });
        const result = await r.json();
        if (!r.ok || result.error) throw new Error(result.error || 'Erro ao atualizar status');
        const raw = rawData.find(l => Number(l.id) === Number(lead.id));
        if (raw) raw.status = col.status;
        toast(`Lead movido para ${col.label}.`, 'success');
        aplicarFiltros();
    } catch (e) {
        lead.status = previousStatus;
        const raw = rawData.find(l => Number(l.id) === Number(lead.id));
        if (raw) raw.status = previousStatus;
        renderKanban();
        toast('Erro ao mover lead: ' + e.message, 'error');
    }
}
function toggleLeadSelecionado(id, checked) {
    const leadId = Number(id);
    if (checked) leadsSelecionados.add(leadId);
    else leadsSelecionados.delete(leadId);
    atualizarSelecaoLeads();
}

function toggleTodosLeads(checked) {
    for (const lead of dadosFiltrados) {
        const id = Number(lead.id);
        if (checked) leadsSelecionados.add(id);
        else leadsSelecionados.delete(id);
    }
    document.querySelectorAll('.lead-row-check').forEach(input => {
        input.checked = checked;
    });
    atualizarSelecaoLeads();
}

function atualizarSelecaoLeads() {
    const selecionadosFiltrados = dadosFiltrados.filter(lead => leadsSelecionados.has(Number(lead.id))).length;
    const totalFiltrados = dadosFiltrados.length;
    const checkTodos = $('checkTodosLeads');
    if (checkTodos) {
        checkTodos.checked = totalFiltrados > 0 && selecionadosFiltrados === totalFiltrados;
        checkTodos.indeterminate = selecionadosFiltrados > 0 && selecionadosFiltrados < totalFiltrados;
    }

    const info = $('leadsSelecionadosInfo');
    const btn = $('btnExcluirLeads');
    if (info) {
        info.style.display = leadsSelecionados.size ? '' : 'none';
        info.textContent = `${leadsSelecionados.size} selecionado${leadsSelecionados.size === 1 ? '' : 's'}`;
    }
    if (btn) btn.style.display = leadsSelecionados.size ? 'inline-flex' : 'none';
}

let idsExclusaoLeadsPendente = [];

function excluirLeadsSelecionados() {
    const ids = [...leadsSelecionados];
    if (!ids.length) return toast('Selecione pelo menos um lead.', 'error');
    idsExclusaoLeadsPendente = ids;
    const quantidade = ids.length;
    $('tituloExcluirLeads').textContent = quantidade === 1 ? 'Excluir lead?' : `Excluir ${quantidade} leads?`;
    $('subtituloExcluirLeads').textContent = quantidade === 1
        ? 'Você está prestes a remover um lead'
        : 'Você está prestes a remover vários leads';
    $('textoExcluirLeads').textContent = quantidade === 1
        ? 'O lead selecionado será excluído permanentemente.'
        : `Os ${quantidade} leads selecionados serão excluídos permanentemente.`;
    $('modalExcluirLeads').classList.add('open');
    lucide.createIcons({ nodes: [$('modalExcluirLeads')] });
    setTimeout(() => $('btnConfirmarExcluirLeads')?.focus(), 50);
}

function fecharModalExcluirLeads() {
    $('modalExcluirLeads')?.classList.remove('open');
    idsExclusaoLeadsPendente = [];
}

async function confirmarExclusaoLeads() {
    const ids = [...idsExclusaoLeadsPendente];
    if (!ids.length) return fecharModalExcluirLeads();

    const btn = $('btnConfirmarExcluirLeads');
    const original = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = 'Excluindo...'; }

    try {
        let totalExcluido = 0;
        for (let i = 0; i < ids.length; i += 500) {
            const lote = ids.slice(i, i + 500);
            const body = { ids: lote };
            const clienteId = leadClienteAdminAtual();
            if (clienteId) body.cliente_id = clienteId;
            const response = await authFetch('/api/leads-delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const result = await readApiJson(response, 'Falha ao excluir leads');
            totalExcluido += Number(result.deleted || 0);
            for (const id of result.ids || lote) leadsSelecionados.delete(Number(id));
        }
        toast(`${totalExcluido} lead${totalExcluido === 1 ? '' : 's'} excluído${totalExcluido === 1 ? '' : 's'}.`, 'success');
        fecharModalExcluirLeads();
        await recarregarLeads();
    } catch (error) {
        toast('Erro ao excluir: ' + error.message, 'error');
        atualizarSelecaoLeads();
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
        lucide.createIcons({ nodes: [btn].filter(Boolean) });
    }
}

// Logos oficiais (SVG inline, sem CDN) das plataformas de origem do lead.
const _PLATFORM_ICONS = {
    facebook: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.87v-6.98H7.9V12h2.5V9.8c0-2.47 1.47-3.84 3.72-3.84 1.08 0 2.2.19 2.2.19v2.43h-1.24c-1.22 0-1.6.76-1.6 1.53V12h2.72l-.44 2.89h-2.28v6.98A10 10 0 0 0 22 12"/></svg>',
    instagram: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.02-3.58.07-4.85c.15-3.23 1.67-4.77 4.92-4.92 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07c-4.35.2-6.78 2.62-6.98 6.98C.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.2-4.35-2.62-6.78-6.98-6.98C15.67.01 15.26 0 12 0m0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84M12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4m6.41-10.85a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44"/></svg>',
    whatsapp: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m0 1.67a8.2 8.2 0 0 1 5.83 2.42 8.19 8.19 0 0 1 2.41 5.82c0 4.55-3.7 8.24-8.25 8.24a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.25-4.37c0-4.55 3.7-8.25 8.24-8.25m-4.53 4.7c-.16 0-.42.06-.64.3-.22.24-.85.83-.85 2.03s.87 2.36.99 2.52c.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.81-.2-.48-.4-.42-.55-.42h-.02"/></svg>',
    google: '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.89c2.28-2.1 3.56-5.2 3.56-8.81"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.89-3c-1.08.73-2.46 1.15-4.06 1.15-3.12 0-5.77-2.1-6.72-4.94H1.27v3.1A12 12 0 0 0 12 24"/><path fill="#FBBC05" d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4.01 3.1C6.23 6.87 8.88 4.77 12 4.77"/></svg>',
};

function obterOrigemLead(origem) {
    const key = String(origem || 'ctwa').toLowerCase();
    const mapa = {
        ctwa:          { label:'Anúncio CTWA',       color:'#3b82f6', bg:'rgba(59,130,246,.12)',  border:'rgba(59,130,246,.25)' },
        organic:       { label:'Orgânico',           color:'#f59e0b', bg:'rgba(245,158,11,.12)',  border:'rgba(245,158,11,.25)' },
        bio:           { label:'Link da bio',        color:'#a855f7', bg:'rgba(168,85,247,.12)',  border:'rgba(168,85,247,.25)' },
        campaign_link: { label:'Link rastreável',    color:'#06b6d4', bg:'rgba(6,182,212,.12)',   border:'rgba(6,182,212,.25)' },
        rotator:       { label:'Rotador',            color:'#10b981', bg:'rgba(16,185,129,.12)',  border:'rgba(16,185,129,.25)' },
        intelligent:   { label:'Rastr. inteligente', color:'#8b5cf6', bg:'rgba(139,92,246,.12)',  border:'rgba(139,92,246,.25)' },
    };
    return mapa[key] || mapa.organic;
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

async function renderRelatorios() {
    if (typeof ensureChart === 'function') await ensureChart();
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
        const clienteId = leadClienteAdminAtual();
        if (clienteId) params.append('cliente_id', clienteId);
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
    try { await ensurePdf(); } catch {
        toast('Falha ao carregar bibliotecas de exportação. Verifique sua conexão.', 'error');
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

async function renderTimelineChart() {
    if (typeof ensureChart === 'function') await ensureChart();
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
    if (window.lucide) lucide.createIcons({ nodes: [$('qualificarModal')] });
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

// Atalho: abre a conversa do lead num POPUP (modal) sobre a aba Leads, sem
// trocar de aba. Reaproveita os paineis do monitor (thread + lead), movendo-os
// temporariamente para dentro do modal e devolvendo-os ao fechar.
async function abrirConversaDoLead(leadId) {
    const lead = (rawData || []).find(l => Number(l.id) === Number(leadId));
    if (!lead) { toast('Lead não encontrado.', 'error'); return; }
    const telefone = String(lead.telefone || '').replace(/\D/g, '');
    if (!telefone) { toast('Lead sem telefone válido.', 'error'); return; }
    if (typeof chatAbrirConversaPorTelefone !== 'function') {
        toast('Monitor de conversas indisponível.', 'error');
        return;
    }

    const slot = $('chatModalSlot');
    const overlay = $('chatModalOverlay');
    const thread = document.querySelector('.chat-thread-panel');
    const leadPanel = document.querySelector('.chat-lead-panel');
    if (!slot || !overlay || !thread) { toast('Não foi possível abrir a conversa.', 'error'); return; }

    // Move os paineis do monitor para dentro do modal (preserva IDs e listeners).
    slot.appendChild(thread);
    if (leadPanel) slot.appendChild(leadPanel);
    slot.classList.add('chat-modal-loaded');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (window.lucide?.createIcons) lucide.createIcons({ nodes: [overlay] });

    // Carrega/seleciona a conversa (assume o controle da carga, sem trocar de aba).
    if (typeof chatState !== 'undefined') chatState.openingByPhone = true;
    await chatAbrirConversaPorTelefone(telefone, lead.instancia || '', lead.cliente_id ?? null);
}

// Fecha o popup e devolve os paineis do monitor ao seu lugar original (a shell da aba Conversas).
function fecharConversaModal() {
    const overlay = $('chatModalOverlay');
    const shell = $('chatMonitorShell');
    const thread = document.querySelector('.chat-modal-slot .chat-thread-panel');
    const leadPanel = document.querySelector('.chat-modal-slot .chat-lead-panel');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
    // Se a aba Conversas nao estiver aberta, para o polling que a abertura ligou.
    const conversasVisivel = !$('aba-conversas')?.classList.contains('aba-oculta');
    if (!conversasVisivel && typeof chatStopPolling === 'function') chatStopPolling();
    // Devolve os paineis para a shell, na ordem correta (thread depois da lista,
    // lead por ultimo) — a chat-list-panel nunca sai da shell.
    if (shell && thread) {
        const listPanel = shell.querySelector('.chat-list-panel');
        if (listPanel && listPanel.nextSibling) shell.insertBefore(thread, listPanel.nextSibling);
        else shell.appendChild(thread);
        if (leadPanel) shell.appendChild(leadPanel);
    }
    if (typeof chatState !== 'undefined') chatState.openingByPhone = false;
}

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
        // Histórico de eventos de conversão (jornada) — best-effort, não bloqueia o perfil.
        lpCarregarEventos(leadId, _lpDados.lead?.cliente_id);
    } catch(e) {
        $('lpLoading').innerHTML = `<span style="color:var(--muted)">Erro ao carregar: ${e.message}</span>`;
    }
}

// Busca e renderiza os eventos de conversão (lead_journey_history) na aba Jornada.
async function lpCarregarEventos(leadId, clienteId) {
    const box = $('lpEventosConversao');
    if (!box) return;
    box.innerHTML = '';
    try {
        const q = clienteId ? `&cliente_id=${clienteId}` : '';
        const r = await authFetch(`/api/journey-stages?lead_id=${leadId}${q}`);
        if (!r.ok) return;
        const eventos = await r.json();
        if (!Array.isArray(eventos) || !eventos.length) return;
        const STATUS = {
            sent:    { label: 'Enviado',  cor: '#10b981', bg: 'rgba(16,185,129,.12)' },
            error:   { label: 'Erro',     cor: '#ef4444', bg: 'rgba(239,68,68,.12)' },
            pending: { label: 'Pendente', cor: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
            skipped: { label: 'Pulada',   cor: 'var(--muted)', bg: 'var(--bg-primary)' },
        };
        box.innerHTML = `
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Eventos de Conversão (Meta)</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${eventos.map(ev => {
                    const st = STATUS[ev.meta_status] || STATUS.pending;
                    const valor = ev.value ? ` · R$ ${parseFloat(ev.value).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : '';
                    const podeReenviar = ev.meta_status === 'error';
                    return `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--bg-secondary);">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <span style="font-size:13px;font-weight:600;color:var(--text-primary);">${esc(ev.event_name || ev.event_concept)}</span>
                            <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${st.bg};color:${st.cor};">${st.label}</span>
                            ${ev.stage_name ? `<span style="font-size:11px;color:var(--muted);">${esc(ev.stage_name)}</span>` : ''}
                            <span style="font-size:11px;color:var(--muted);margin-left:auto;">${valor}</span>
                        </div>
                        ${ev.meta_response ? `<div style="font-size:11px;color:#ef4444;margin-top:5px;">${esc(ev.meta_response)}</div>` : ''}
                        ${podeReenviar ? `<button class="btn btn-sm" onclick="lpReenviarEvento(${ev.id}, ${leadId}, ${clienteId||'null'})" style="margin-top:8px;background:var(--blue);color:#fff;font-size:12px;padding:5px 10px;border-radius:6px;">Reenviar para Meta</button>` : ''}
                    </div>`;
                }).join('')}
            </div>`;
    } catch (_) { /* best-effort */ }
}

async function lpReenviarEvento(historyId, leadId, clienteId) {
    try {
        const r = await authFetch('/api/journey-stages', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'resend', history_id: historyId, cliente_id: clienteId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Falha');
        if (d.capi && d.capi.sent) toast('Evento reenviado à Meta.', 'success');
        else toast('Reenvio falhou: ' + (d.capi?.error || 'erro'), 'warning');
        lpCarregarEventos(leadId, clienteId);
    } catch (e) {
        toast('Erro: ' + e.message, 'error');
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

// lpRow(label, valor, cor, sempreMostrar)
// Por padrão, OMITE a linha quando o valor é vazio (reduz o "mar de —" no drawer).
// Campos essenciais (Nome, Telefone, Status...) passam sempreMostrar=true para
// exibir "—" mesmo vazios — a ausência ali é informativa.
function lpRow(label, valor, cor, sempreMostrar) {
    const vazio = !valor || valor === '—';
    if (vazio && !sempreMostrar) return '';
    if (vazio) return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;"><span style="font-size:12px;color:var(--muted);flex-shrink:0;">${label}</span><span style="font-size:13px;color:var(--muted);font-style:italic;">—</span></div>`;
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;"><span style="font-size:12px;color:var(--muted);flex-shrink:0;">${label}</span><span style="font-size:13px;color:${cor||'var(--text-primary)'};font-weight:500;text-align:right;word-break:break-word;">${esc(valor)}</span></div>`;
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

function lpPreencherDados({ lead, jornada, interacoes }) {
    // ── Header ──
    const inicial = (lead.nome || '?')[0].toUpperCase();
    $('lpAvatar').textContent = inicial;
    $('lpNome').textContent = lead.nome || 'Sem nome';
    $('lpTelefone').textContent = lead.telefone || '—';
    const status = (lead.status || 'lead');
    const isVendido = status.toLowerCase() === 'vendido' || status.toLowerCase() === 'venda_fechada';
    const isQualif = status.toLowerCase() === 'qualificado';
    const isAgendado = status.toLowerCase() === 'agendado';
    const badgeColor = isVendido ? '#10b981' : isQualif ? '#6366f1' : isAgendado ? '#f59e0b' : 'var(--muted)';
    const badgeBg = isVendido ? 'rgba(16,185,129,.12)' : isQualif ? 'rgba(99,102,241,.12)' : isAgendado ? 'rgba(245,158,11,.12)' : 'var(--bg-secondary)';
    $('lpStatusBadge').textContent = status;
    $('lpStatusBadge').style.color = badgeColor;
    $('lpStatusBadge').style.background = badgeBg;
    $('lpStatusBadge').style.borderColor = isVendido ? 'rgba(16,185,129,.3)' : isQualif ? 'rgba(99,102,241,.3)' : isAgendado ? 'rgba(245,158,11,.3)' : 'var(--border)';

    // ── Aba Perfil ──
    $('lpRowNome').innerHTML     = lpRow('Nome completo', lead.nome, null, true);
    $('lpRowTel').innerHTML      = lpRow('Telefone', lead.telefone, null, true);
    $('lpRowEmail').innerHTML    = lpRow('E-mail', lead.email);
    $('lpRowCpf').innerHTML      = lpRow('CPF', lead.cpf);
    $('lpRowEndereco').innerHTML = lpRow('Endereço', [lead.endereco, lead.cidade, lead.estado].filter(Boolean).join(', ') || null);
    $('lpRowStatus').innerHTML   = lpRow('Status', status, badgeColor, true);
    $('lpRowInstancia').innerHTML = lpRow('Instância', lead.instancia);
    $('lpRowPlataforma').innerHTML = lpRow('Plataforma', lead.plataforma);
    $('lpRowDispositivo').innerHTML = lpRow('Dispositivo', lead.device && lead.device.label);
    $('lpRowEntrada').innerHTML  = lpRow('Data de entrada', lpFormatData(lead.created_at));
    $('lpMensagem').textContent  = lead.mensagem_recebida || '—';

    // ── Aba Anúncio ──
    const origemInfo = obterOrigemLead(lead.lead_origin);
    $('lpRowOrigem').innerHTML    = lpRow('Origem do lead', origemInfo.label, origemInfo.color, true);
    $('lpRowTrackingCampanha').innerHTML = lpRow('Link rastreável', lead.tracking_campaign_name);
    $('lpRowCampanha').innerHTML  = lpRow('Campanha', lead.utm_campaign, '#3b82f6');
    $('lpRowConjunto').innerHTML  = lpRow('Conjunto', lead.utm_medium, '#6366f1');
    $('lpRowAnuncio').innerHTML   = lpRow('Anúncio', lead.utm_content);
    $('lpRowPlat').innerHTML      = lpRow('Plataforma', lead.plataforma);
    $('lpRowTrackingMetodo').innerHTML = lpRow('Método de atribuição', lead.tracking_method === 'token' ? 'Token invisível validado' : lead.tracking_method);
    $('lpRowCtwa').innerHTML      = lpRow('CTWA Click ID', lead.ctw_aci_id ? lead.ctw_aci_id.substring(0,24)+'…' : null);
    $('lpRowSourceId').innerHTML  = lpRow('Source ID (Anúncio)', lead.source_id);
    $('lpRowPageId').innerHTML    = lpRow('Page ID', lead.page_id);
    const clickLocation = lead.click_location || {};
    $('lpRowClickIp').innerHTML     = lpRow('IP do clique', clickLocation.ip);
    $('lpRowClickCidade').innerHTML = lpRow('Cidade do clique', clickLocation.city);
    $('lpRowClickEstado').innerHTML = lpRow(
        'Estado / região',
        [clickLocation.region, clickLocation.region_code].filter(Boolean).join(' - ') || null
    );
    $('lpRowClickPais').innerHTML   = lpRow(
        'País do clique',
        [clickLocation.country, clickLocation.country_code].filter(Boolean).join(' - ') || null
    );
    // Parâmetros do anúncio (placement, IDs Meta, gclid) capturados no clique.
    const clickAd = lead.click_ad || {};
    $('lpRowPlacement').innerHTML      = lpRow('Posicionamento', clickAd.placement);
    $('lpRowAdId').innerHTML           = lpRow('Ad ID (Meta)', clickAd.ad_id);
    $('lpRowAdsetId').innerHTML        = lpRow('Conjunto ID (Meta)', clickAd.adset_id);
    $('lpRowMetaCampaignId').innerHTML = lpRow('Campanha ID (Meta)', clickAd.meta_campaign_id);
    $('lpRowGclid').innerHTML          = lpRow('Google Click ID', clickAd.gclid ? clickAd.gclid.substring(0,24)+'…' : null);
    $('lpRowGoogleKeyword').innerHTML  = lpRow('Palavra-chave (Google Ads)', clickAd.google_ads_keyword);

    // ── Aba Jornada ──
    // No modelo de contato único, cada TOQUE é um clique no link (tracking_clicks),
    // não um lead novo. Quando há interações (cliques), elas são a jornada — com o
    // dispositivo de cada toque. Sem cliques (lead CTWA/orgânico/legado), cai no
    // histórico de leads do mesmo telefone (compatibilidade).
    const toques = (interacoes && interacoes.length) ? interacoes : null;
    if (toques) {
        const total = toques.length;
        $('lpJornadaResumo').innerHTML = `<strong style="color:var(--text-primary);">${total} interaç${total !== 1 ? 'ões' : 'ão'}</strong> registrad${total !== 1 ? 'as' : 'a'} para este número (cliques no link).`;
        $('lpTimeline').innerHTML = toques.map((k, i) => {
            const isCurrent = k.id === lead.tracking_click_id;
            const dotColor = isCurrent ? '#3b82f6' : 'var(--muted)';
            const linhaAds = [k.utm_content, k.utm_medium, k.utm_campaign].filter(Boolean);
            const origem = obterOrigemLead(k.origin_type === 'campaign' ? 'campaign_link' : k.origin_type);
            const dev = k.device && k.device.label;
            const localClique = [k.geo_city, k.geo_region_code || k.geo_region, k.geo_country_code || k.geo_country].filter(Boolean).join(' · ');
            return `<div style="display:flex;gap:14px;">
                <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
                    <div style="width:12px;height:12px;border-radius:50%;background:${dotColor};border:2px solid ${dotColor};margin-top:3px;flex-shrink:0;${isCurrent?'box-shadow:0 0 0 3px rgba(59,130,246,.2)':''}"></div>
                    ${i < toques.length-1 ? `<div style="width:2px;flex:1;background:var(--border);margin:4px 0;min-height:30px;"></div>` : ''}
                </div>
                <div style="padding-bottom:20px;flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
                        <span style="font-size:12px;font-weight:700;color:var(--text-primary);">${i+1}º toque</span>
                        ${isCurrent ? `<span style="font-size:10px;background:rgba(59,130,246,.1);color:#3b82f6;padding:1px 7px;border-radius:10px;border:1px solid rgba(59,130,246,.2);">origem</span>` : ''}
                        <span style="font-size:11px;color:var(--muted);margin-left:auto;">${lpFormatData(k.clicked_at)}</span>
                    </div>
                    <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:5px;">
                        ${linhaAds.length ? `
                            ${k.utm_content  ? `<div style="font-size:12px;"><span style="color:var(--muted);">🎯 Anúncio: </span><span style="color:var(--text-primary);font-weight:500;">${esc(k.utm_content)}</span></div>` : ''}
                            ${k.utm_medium   ? `<div style="font-size:12px;"><span style="color:var(--muted);">🗂 Conjunto: </span><span style="color:#6366f1;font-weight:500;">${esc(k.utm_medium)}</span></div>` : ''}
                            ${k.utm_campaign ? `<div style="font-size:12px;"><span style="color:var(--muted);">📣 Campanha: </span><span style="color:#3b82f6;font-weight:500;">${esc(k.utm_campaign)}</span></div>` : ''}
                        ` : `<div style="font-size:12px;color:var(--muted);">Sem dados de anúncio</div>`}
                        <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
                            <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${origem.bg};border:1px solid ${origem.border};color:${origem.color};">${origem.label}</span>
                            ${k.tracking_campaign_name ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:var(--muted);">${esc(k.tracking_campaign_name)}</span>` : ''}
                            ${dev ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:var(--muted);">📱 ${esc(dev)}</span>` : ''}
                            ${localClique ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:var(--muted);">📍 ${esc(localClique)}</span>` : ''}
                            <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:${k.converted_at?'#10b981':'var(--muted)'};">${k.converted_at ? 'Convertido' : 'Clique'}</span>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    } else {
        const total = jornada.length;
        $('lpJornadaResumo').innerHTML = `<strong style="color:var(--text-primary);">${total} contato${total !== 1 ? 's' : ''}</strong> registrado${total !== 1 ? 's' : ''} para este número.`;
        $('lpTimeline').innerHTML = jornada.map((j, i) => {
            const isCurrent = j.id === lead.id;
            const isV = (j.status||'').toLowerCase() === 'vendido' || (j.status||'').toLowerCase() === 'venda_fechada';
            const dotColor = isV ? '#10b981' : isCurrent ? '#3b82f6' : 'var(--muted)';
            const linhaAds = [j.utm_content, j.utm_medium, j.utm_campaign].filter(Boolean);
            const jornadaOrigem = obterOrigemLead(j.lead_origin);
            return `<div style="display:flex;gap:14px;">
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
                            <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${jornadaOrigem.bg};border:1px solid ${jornadaOrigem.border};color:${jornadaOrigem.color};">${jornadaOrigem.label}</span>
                            ${j.tracking_campaign_name ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:var(--muted);">${esc(j.tracking_campaign_name)}</span>` : ''}
                            <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:${isV?'#10b981':'var(--muted)'};">${j.status||'Lead'}</span>
                            ${j.valor_venda ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);color:#10b981;">💰 R$ ${parseFloat(j.valor_venda).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>` : ''}
                            ${j.plataforma ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-primary);border:1px solid var(--border);color:var(--muted);">${j.plataforma}</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    // ── Aba Venda ──
    const diffResposta = lead.first_response_at && lead.created_at
        ? (new Date(lead.first_response_at) - new Date(lead.created_at)) / 60000 : null;
    const diffCiclo = lead.sale_closed_at && lead.created_at
        ? (new Date(lead.sale_closed_at) - new Date(lead.created_at)) / 60000 : null;

    $('lpCardResposta').textContent = lpFormatDuracao(diffResposta) || '—';
    $('lpCardCiclo').textContent    = lpFormatDuracao(diffCiclo) || '—';
    $('lpRowStatusVenda').innerHTML = lpRow('Status', status, badgeColor, true);
    $('lpRowValor').innerHTML       = lpRow('Valor da venda', lead.valor_venda ? `R$ ${parseFloat(lead.valor_venda).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : null, '#10b981');
    $('lpRowProduto').innerHTML     = lpRow('Produto', lead.produto);
    $('lpRowDataVenda').innerHTML   = lpRow('Data da venda', lpFormatData(lead.sale_closed_at));
    $('lpRowQualificado').innerHTML = lpRow('Qualificado em', lpFormatData(lead.qualified_at));
    $('lpSemVenda').style.display   = isVendido ? 'none' : 'block';
}

