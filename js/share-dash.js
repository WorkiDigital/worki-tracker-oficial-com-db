// ── Helpers ───────────────────────────────────────────────────────────────

function fmt(n, decimals=0) {
    const num = parseFloat(n) || 0;
    if (num >= 1e6) return (num/1e6).toFixed(1)+'M';
    if (num >= 1e3) return (num/1e3).toFixed(1)+'K';
    return num.toLocaleString('pt-BR', { minimumFractionDigits:decimals, maximumFractionDigits:decimals });
}
function fmtBRL(n) {
    return 'R$ '+(parseFloat(n)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function toast(msg, type='info') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('toast-area').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function toggleTheme() {
    const isLight = document.documentElement.classList.toggle('light');
    localStorage.setItem('wt_theme', isLight ? 'light' : 'dark');
}

// Apply saved theme
if (localStorage.getItem('wt_theme') === 'light') document.documentElement.classList.add('light');

// ── Token from URL ────────────────────────────────────────────────────────
const TOKEN = new URLSearchParams(location.search).get('token');

// ── State ─────────────────────────────────────────────────────────────────
let _campaigns = [];
let _bestAds = [];
let _sortedBestAds = []; // sorted copy for onclick/video lookup
let _bestSortKey = 'spend';
let _bestPage = 15;
const _videoDataMap = {}; // videoId → { source, thumbnail } (cache HD)
let _demoCharts = {};
let _config = {};
let _statusFilter = 'ALL'; // runtime filter (ALL, ACTIVE, PAUSED)

const SORT_OPTS = [
    { key:'spend',     label:'Gasto' },
    { key:'impressions', label:'Impressões' },
    { key:'clicks',    label:'Cliques' },
    { key:'ctr',       label:'CTR' },
    { key:'reach',     label:'Alcance' },
    { key:'results',   label:'Resultados' },
];

const DEMO_BREAKDOWNS = [
    { key:'age',                label:'Faixa etária',   icon:'👥' },
    { key:'gender',             label:'Gênero',         icon:'⚥' },
    { key:'publisher_platform', label:'Plataforma',     icon:'📱' },
    { key:'impression_device',  label:'Dispositivo',    icon:'💻' },
    { key:'platform_position',  label:'Posicionamento', icon:'📍' },
];

const POSITION_LABELS = {
    feed:'Feed', reels:'Reels', story:'Stories',
    right_hand_column:'Col. Direita', search:'Busca',
    marketplace:'Marketplace', video_feeds:'Feed de Vídeos',
    instagram_explore:'Explorar (IG)', instagram_explore_grid_home:'Explore Home',
    instream_video:'In-Stream', an_classic:'Aud. Network',
};

const PLATFORM_LABELS = {
    facebook:         'Facebook',
    instagram:        'Instagram',
    audience_network: 'Audience Network',
    messenger:        'Messenger',
};

const DEVICE_LABELS = {
    iphone:             'iPhone',
    android_smartphone: 'Android (celular)',
    android_tablet:     'Android (tablet)',
    ipad:               'iPad',
    desktop_computer:   'Desktop',
    mobile_app:         'App Mobile',
    connected_tv:       'TV Conectada',
};

const DEMO_COLORS = [
    '#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#ef4444','#84cc16'
];

// ── Init ──────────────────────────────────────────────────────────────────
window.onload = () => {
    if (!TOKEN) {
        showError('Link inválido. Nenhum token encontrado na URL.');
        return;
    }
    renderSortPills();
    carregarTudo();
};

async function carregarTudo() {
    const datePreset = $('datePreset').value;
    $('loadingState').style.display = 'flex';
    $('dashContent').style.display = 'none';
    $('errorState').style.display = 'none';

    try {
        // ── Fase 1: campanhas (rápido) ─────────────────────────────
        const adsResp = await fetch(`/api/share-ads?token=${TOKEN}&datePreset=${datePreset}`);
        const adsData = await adsResp.json();
        if (adsData.error) { showError(adsData.error); return; }

        _campaigns = adsData.data || [];
        _config = adsData.config || {};

        const displayName = adsData.client_name || adsData.account_name || 'Conta de Anúncios';
        $('accountName').textContent = displayName;
        document.title = displayName + ' — Relatório';

        if (!window._statusFilterSet) {
            const def = _config.status_filter || 'ALL';
            _statusFilter = def;
            $('statusFilterSel').value = def;
            window._statusFilterSet = true;
        }

        const sec = _config.visible_sections || {};
        const showDemo  = sec.demograficos       !== false;
        const showBest  = sec.melhores_criativos !== false;
        const showFunil = sec.funil              !== false;
        $('tableCard').style.display        = sec.campanhas !== false ? '' : 'none';
        $('demoSectionWrap').style.display  = showDemo  ? '' : 'none';
        $('funilSectionWrap').style.display = showFunil ? '' : 'none';
        $('bestAdsSection').style.display   = showBest  ? '' : 'none';

        renderSummaryMetrics();
        renderTable();

        // Mostra o dashboard imediatamente com esqueletos nas seções secundárias
        $('loadingState').style.display = 'none';
        $('dashContent').style.display = 'block';

        if (showDemo) $('demoGrid').innerHTML = skeletonDemo();

        // ── Fase 2: demos em background ────────────────────────────
        const demoResps = await Promise.all(
            DEMO_BREAKDOWNS.map(b => showDemo
                ? (b.key === 'platform_position'
                    ? fetch(`/api/share-placement?token=${TOKEN}&datePreset=${datePreset}`)
                    : fetch(`/api/share-demo?token=${TOKEN}&datePreset=${datePreset}&breakdown=${b.key}`))
                : Promise.resolve(null)
            )
        );

        if (showDemo) {
            const demoDataArr = await Promise.all(demoResps.map(r => r ? r.json() : null));
            renderAllDemos(demoDataArr);
        }

    } catch(e) {
        showError('Erro ao carregar dados: ' + e.message);
    }
}

async function carregarMelhoresAnuncios() {
    const btn = $('btnCarregarBestAds');
    btn.disabled = true;
    btn.innerHTML = `<svg style="animation:spin 1s linear infinite" xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0"/></svg> Carregando...`;

    try {
        const datePreset = $('datePreset').value;
        const resp = await fetch(`/api/share-best?token=${TOKEN}&datePreset=${datePreset}`);
        const data = await resp.json();
        if (data.error) { toast(data.error, 'error'); return; }

        _bestAds = data.data || [];
        _bestPage = 15;
        $('bestAdsEmpty').style.display = 'none';
        $('bestAdsLoaded').style.display = '';
        renderSortPills();
        renderBestAds();

        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> Atualizar`;
    } catch(e) {
        toast('Erro ao carregar criativos', 'error');
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg> Carregar Criativos`;
    } finally {
        btn.disabled = false;
    }
}

function skeletonDemo() {
    return Array(4).fill(0).map(() => `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;display:flex;flex-direction:column;align-items:center;gap:10px;">
            <div style="height:12px;width:80px;background:var(--border);border-radius:4px;animation:pulse 1.5s infinite;"></div>
            <div style="width:120px;height:120px;border-radius:50%;background:var(--border);animation:pulse 1.5s infinite;"></div>
            ${Array(4).fill(0).map(() => `<div style="height:10px;width:100%;background:var(--border);border-radius:4px;animation:pulse 1.5s infinite;"></div>`).join('')}
        </div>`).join('');
}

function showError(msg) {
    $('loadingState').style.display = 'none';
    $('dashContent').style.display = 'none';
    $('errorState').style.display = 'block';
    $('errorState').innerHTML = `<div class="error-box"><strong>Erro</strong><br>${esc(msg)}</div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function campaignMetrics(campaigns) {
    let spend=0, imps=0, reach=0, leads=0, msgs=0, lpv=0, seguidores=0, clicks=0;
    let purchases=0, purchaseValue=0, initCheckout=0, roasSum=0, roasCount=0;
    let cpmSum=0, cpmCount=0, cpcSum=0, cpcCount=0, ctrSum=0, ctrCount=0, freqSum=0, freqCount=0;
    campaigns.forEach(c => {
        const ins = getInsights(c); if (!ins) return;
        const sp  = parseFloat(ins.spend||0);
        const imp = parseInt(ins.impressions||0);
        spend += sp; imps += imp; reach += parseInt(ins.reach||0);
        clicks     += getAct(ins, ['link_click']);
        leads      += getAct(ins, ['lead','offsite_conversion.lead']);
        msgs       += getAct(ins, ['onsite_conversion.messaging_conversation_started_7d']);
        lpv        += getAct(ins, ['landing_page_view']);
        seguidores += getAct(ins, ['like']);
        purchases     += getAct(ins, ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase']);
        purchaseValue += getActVal(ins, ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase']);
        initCheckout  += getAct(ins, ['initiate_checkout','offsite_conversion.fb_pixel_initiate_checkout','omni_initiate_checkout']);
        const roasVal = getRoas(ins);
        if (roasVal && sp) { roasSum += roasVal * sp; roasCount += sp; }
        const cpmV = parseFloat(ins.cpm||0);      if (cpmV && imp) { cpmSum += cpmV*imp;  cpmCount += imp; }
        const cpcV = parseFloat(ins.cpc||0); const clk = parseInt(ins.clicks||0);
        if (cpcV && clk) { cpcSum += cpcV*clk; cpcCount += clk; }
        const freqV = parseFloat(ins.frequency||0); if (freqV && imp) { freqSum += freqV*imp; freqCount += imp; }
        const ctrV  = parseFloat(ins.ctr||0);       if (ctrV  && imp) { ctrSum  += ctrV*imp;  ctrCount  += imp; }
    });
    return {
        spend, imps, reach, clicks, leads, msgs, lpv, seguidores,
        purchases, purchaseValue, initCheckout,
        roas: roasCount ? roasSum/roasCount : 0,
        cpm:  cpmCount  ? cpmSum/cpmCount   : 0,
        cpc:  cpcCount  ? cpcSum/cpcCount   : 0,
        freq: freqCount ? freqSum/freqCount : 0,
        ctr:  ctrCount  ? ctrSum/ctrCount   : 0,
    };
}

// ── Filters ───────────────────────────────────────────────────────────────
function filteredCampaigns() {
    return _campaigns.filter(c => {
        if (_statusFilter !== 'ALL' && c.status !== _statusFilter) return false;
        // ACTIVE filtra só campanhas com gasto real no período
        if (_statusFilter === 'ACTIVE') {
            const spend = parseFloat(c.insights?.data?.[0]?.spend || 0);
            if (spend === 0) return false;
        }
        return true;
    });
}

function aplicarFiltroStatus() {
    _statusFilter = $('statusFilterSel').value;
    renderSummaryMetrics();
    renderTable();
}

// ── Summary Metrics ───────────────────────────────────────────────────────
function getInsights(camp) {
    return camp.insights?.data?.[0] || null;
}
function renderSummaryMetrics() {
    const m = campaignMetrics(filteredCampaigns());
    const activeCamp = _campaigns.filter(c => c.status === 'ACTIVE').length;

    const allowed = _config.visible_metrics || ['spend','imps','reach','cpm','ctr','leads','cpl','msgs','cpr','active_campaigns'];
    const ALL_CARDS = [
        { key:'spend',            label:'Gasto Total',          value: m.spend   ? fmtBRL(m.spend)       : '—',  color:'#10b981' },
        { key:'imps',             label:'Impressões',           value: fmt(m.imps),                               color:'#8b5cf6' },
        { key:'reach',            label:'Alcance',              value: m.reach   ? fmt(m.reach)           : '—',  color:'#3b82f6' },
        { key:'freq',             label:'Frequência',           value: m.freq    ? m.freq.toFixed(2)      : '—',  color:'#f59e0b' },
        { key:'cpm',              label:'CPM',                  value: m.cpm     ? fmtBRL(m.cpm)          : '—',  color:'#a78bfa' },
        { key:'cpc',              label:'CPC',                  value: m.cpc     ? fmtBRL(m.cpc)          : '—',  color:'#fb923c' },
        { key:'ctr',              label:'CTR Médio',            value: m.ctr     ? m.ctr.toFixed(2)+'%'  : '—',  color:'#ec4899' },
        { key:'lpv',              label:'Visitas pág. destino', value: m.lpv     ? fmt(m.lpv)             : '—',  color:'#34d399' },
        { key:'cplpv',            label:'Custo/visita',         value: m.lpv     ? fmtBRL(m.spend/m.lpv)  : '—',  color:'#60a5fa' },
        { key:'leads',            label:'Leads',                value: fmt(m.leads),                              color:'#06b6d4' },
        { key:'cpl',              label:'CPL',                  value: m.leads   ? fmtBRL(m.spend/m.leads): '—',  color:'#f472b6' },
        { key:'msgs',             label:'Conversas',            value: fmt(m.msgs),                               color:'#4ade80' },
        { key:'cpr',              label:'CPR',                  value: m.msgs    ? fmtBRL(m.spend/m.msgs) : '—',  color:'#facc15' },
        { key:'seguidores',       label:'Seguidores',           value: m.seguidores ? fmt(m.seguidores)   : '—',  color:'#c084fc' },
        { key:'cps',              label:'Custo/seguidor',       value: m.seguidores ? fmtBRL(m.spend/m.seguidores): '—', color:'#f87171' },
        { key:'purchases',        label:'Compras',              value: m.purchases ? fmt(m.purchases) : '—',       color:'#ec4899' },
        { key:'purchase_value',   label:'Valor em Compras',     value: m.purchaseValue ? fmtBRL(m.purchaseValue) : '—', color:'#f472b6' },
        { key:'roas',             label:'ROAS',                 value: m.roas ? m.roas.toFixed(2)+'x' : '—',       color:'#10b981' },
        { key:'init_checkout',    label:'Inícios de Checkout',  value: m.initCheckout ? fmt(m.initCheckout) : '—', color:'#f59e0b' },
        { key:'cpp',              label:'Custo/compra',         value: m.purchases ? fmtBRL(m.spend/m.purchases) : '—', color:'#ef4444' },
        { key:'active_campaigns', label:'Campanhas Ativas',     value: activeCamp,                                color:'#2dd4bf' },
    ].filter(c => allowed.includes(c.key));

    $('summaryMetrics').innerHTML = ALL_CARDS.map((c,i) => `
        <div class="ads-metric" style="animation-delay:${i*.05}s">
            <div class="ads-metric-val" style="color:${c.color}">${c.value}</div>
            <div class="ads-metric-lbl">${c.label}</div>
        </div>
    `).join('');

    // Atualiza funil com métricas atuais
    _funilData = { spend: m.spend, imps: m.imps, reach: m.reach, clicks: m.clicks, lpv: m.lpv, leads: m.leads, msgs: m.msgs, purchases: m.purchases };
    renderFunil();
}

// ── Table ─────────────────────────────────────────────────────────────────
function statusBadge(status) {
    const map = {
        ACTIVE:   { bg:'rgba(16,185,129,.15)', color:'#10b981', label:'Ativo' },
        PAUSED:   { bg:'rgba(107,114,128,.15)', color:'#9ca3af', label:'Pausado' },
        ARCHIVED: { bg:'rgba(239,68,68,.1)',  color:'#ef4444',  label:'Arquivado' },
    };
    const s = map[status] || { bg:'var(--tag)', color:'var(--muted)', label: status };
    return `<span class="status-badge" style="background:${s.bg};color:${s.color}">${s.label}</span>`;
}

const ALL_COL_DEFS = [
    { key:'status',     th:'Status' },
    { key:'spend',      th:'Gasto' },
    { key:'imps',       th:'Impressões' },
    { key:'reach',      th:'Alcance' },
    { key:'freq',       th:'Freq.' },
    { key:'cpm',        th:'CPM' },
    { key:'clicks',     th:'Cliques' },
    { key:'cpc',        th:'CPC' },
    { key:'ctr',        th:'CTR' },
    { key:'lpv',        th:'Visitas' },
    { key:'cplpv',      th:'Custo/visita' },
    { key:'leads',      th:'Leads' },
    { key:'cpl',        th:'CPL' },
    { key:'msgs',       th:'Conversas' },
    { key:'cpr',        th:'CPR' },
    { key:'seguidores', th:'Seguidores' },
    { key:'cps',        th:'Custo/seg.' },
    { key:'purchases',      th:'Compras' },
    { key:'purchase_value', th:'Valor Compras' },
    { key:'roas',           th:'ROAS' },
    { key:'init_checkout',  th:'Inícios Checkout' },
    { key:'cpp',            th:'Custo/compra' },
];

function renderTable() {
    const rows = filteredCampaigns();
    const cols = _config.visible_columns || ['status','spend','imps','reach','cpm','clicks','ctr','leads','cpl','msgs','cpr'];
    const COL_DEFS = ALL_COL_DEFS.filter(c => cols.includes(c.key));

    const thead = document.querySelector('#campTable thead tr');
    if (thead) {
        thead.innerHTML = '<th style="text-align:left">Campanha</th>' +
            COL_DEFS.map(c => `<th>${c.th}</th>`).join('');
    }

    $('campCount').textContent = rows.length;
    if (!rows.length) {
        $('campTableBody').innerHTML = `<tr class="empty-row"><td colspan="${COL_DEFS.length+1}" style="text-align:center;color:var(--muted);padding:40px">Sem campanhas no período</td></tr>`;
        return;
    }
    $('campTableBody').innerHTML = rows.map(c => {
        const ins    = getInsights(c);
        const spend  = parseFloat(ins?.spend||0);
        const leads  = getAct(ins, ['lead','offsite_conversion.lead']);
        const msgs   = getAct(ins, ['onsite_conversion.messaging_conversation_started_7d']);
        const lpv    = getAct(ins, ['landing_page_view']);
        const seg    = getAct(ins, ['like']);
        const clicks = getAct(ins, ['link_click']);
        const purchases  = getAct(ins, ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase']);
        const purchaseVal= getActVal(ins, ['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase']);
        const initCk     = getAct(ins, ['initiate_checkout','offsite_conversion.fb_pixel_initiate_checkout','omni_initiate_checkout']);
        const roas       = getRoas(ins);
        const cells = COL_DEFS.map(col => {
            switch(col.key) {
                case 'status':     return `<td>${statusBadge(c.status)}</td>`;
                case 'spend':      return `<td>${spend  ? fmtBRL(spend)  : '—'}</td>`;
                case 'imps':       return `<td>${fmt(ins?.impressions)}</td>`;
                case 'reach':      return `<td>${fmt(ins?.reach)}</td>`;
                case 'freq':       { const v=parseFloat(ins?.frequency||0); return `<td>${v?v.toFixed(2):'—'}</td>`; }
                case 'cpm':        return `<td>${ins?.cpm  ? fmtBRL(ins.cpm)  : '—'}</td>`;
                case 'clicks':     return `<td>${clicks ? fmt(clicks) : '—'}</td>`;
                case 'cpc':        return `<td>${ins?.cpc  ? fmtBRL(ins.cpc)  : '—'}</td>`;
                case 'ctr':        { const v=parseFloat(ins?.ctr||0); return `<td>${v?v.toFixed(2)+'%':'—'}</td>`; }
                case 'lpv':        return `<td>${lpv   ? fmt(lpv)         : '—'}</td>`;
                case 'cplpv':      return `<td>${lpv   ? fmtBRL(spend/lpv): '—'}</td>`;
                case 'leads':      return `<td>${fmt(leads)}</td>`;
                case 'cpl':        return `<td>${leads ? fmtBRL(spend/leads): '—'}</td>`;
                case 'msgs':       return `<td>${fmt(msgs)}</td>`;
                case 'cpr':        return `<td>${msgs  ? fmtBRL(spend/msgs) : '—'}</td>`;
                case 'seguidores': return `<td>${seg   ? fmt(seg)           : '—'}</td>`;
                case 'cps':        return `<td>${seg   ? fmtBRL(spend/seg)  : '—'}</td>`;
                case 'purchases':      return `<td>${purchases ? fmt(purchases) : '—'}</td>`;
                case 'purchase_value': return `<td>${purchaseVal ? fmtBRL(purchaseVal) : '—'}</td>`;
                case 'roas':           return `<td>${roas ? roas.toFixed(2)+'x' : '—'}</td>`;
                case 'init_checkout':  return `<td>${initCk ? fmt(initCk) : '—'}</td>`;
                case 'cpp':            return `<td>${purchases ? fmtBRL(spend/purchases) : '—'}</td>`;
                default:           return '<td>—</td>';
            }
        }).join('');
        return `<tr><td class="td-name">${esc(c.name)}</td>${cells}</tr>`;
    }).join('');
}

// ── Demographics ──────────────────────────────────────────────────────────
function renderAllDemos(demoDataArr) {
    $('demoGrid').innerHTML = '';
    DEMO_BREAKDOWNS.forEach((b, i) => {
        const resp = demoDataArr[i];
        if (!resp || resp.error) return;
        renderDemoCard(b, resp.data || [], resp.period);
    });
    const count = $('demoGrid').children.length;
    $('demoGrid').classList.toggle('demo-grid--5', count === 5);
}

function renderDemoCard(breakdown, data, period) {
    const totalSpend = data.reduce((a,d) => a+(parseFloat(d.spend)||0), 0);
    if (totalSpend === 0) return;

    const sorted = [...data].sort((a,b) => (parseFloat(b.spend)||0)-(parseFloat(a.spend)||0));
    const top = sorted.slice(0,8);

    const card = document.createElement('div');
    card.className = 'demo-card';

    const chartId = 'demo-chart-' + breakdown.key;
    const fallbackNote = period === 'maximum' ? ' <span style="font-size:10px;color:var(--muted)">(histórico)</span>' : '';

    card.innerHTML = `
        <div class="demo-card-title">${breakdown.icon} ${breakdown.label}${fallbackNote}</div>
        <div class="demo-canvas-wrap"><canvas id="${chartId}"></canvas></div>
        <div class="demo-legend">
            ${top.map((d,i) => {
                const spend = parseFloat(d.spend)||0;
                const pct = totalSpend > 0 ? (spend/totalSpend*100).toFixed(1) : '0.0';
                const rawLabel = d[breakdown.key]||d.age||d.gender||'—';
                const label = breakdown.key==='gender'             ? (d.gender==='male'?'Masculino':'Feminino') :
                              breakdown.key==='platform_position'  ? (POSITION_LABELS[rawLabel]||rawLabel) :
                              breakdown.key==='publisher_platform' ? (PLATFORM_LABELS[rawLabel]||rawLabel) :
                              breakdown.key==='impression_device'  ? (DEVICE_LABELS[rawLabel]||rawLabel) :
                              rawLabel;
                return `<div class="demo-legend-row">
                    <div class="demo-legend-left">
                        <div class="demo-legend-dot" style="background:${DEMO_COLORS[i%DEMO_COLORS.length]}"></div>
                        <span>${esc(label)}</span>
                    </div>
                    <span class="demo-legend-val">${pct}%</span>
                </div>`;
            }).join('')}
        </div>
    `;
    $('demoGrid').appendChild(card);

    // Render chart
    setTimeout(() => {
        const ctx = document.getElementById(chartId)?.getContext('2d');
        if (!ctx) return;
        if (_demoCharts[breakdown.key]) { _demoCharts[breakdown.key].destroy(); }
        const labels = top.map(d => {
            if (breakdown.key==='gender') return d.gender==='male'?'Masc':'Fem';
            const raw = String(d[breakdown.key]||d.age||d.gender||'—');
            if (breakdown.key==='platform_position') return (POSITION_LABELS[raw]||raw).substring(0,12);
            return raw.substring(0,12);
        });
        _demoCharts[breakdown.key] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{ data: top.map(d=>parseFloat(d.spend)||0), backgroundColor: DEMO_COLORS.slice(0,top.length), borderWidth:0, hoverOffset:4 }]
            },
            options: { responsive:true, maintainAspectRatio:true, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ` ${fmtBRL(ctx.raw)}` } } }, cutout:'65%' }
        });
    }, 50);
}

// ── Best Ads ──────────────────────────────────────────────────────────────
function renderSortPills() {
    $('bestSortPills').innerHTML = SORT_OPTS.map(o => `
        <div class="sort-pill ${o.key===_bestSortKey?'active':''}" onclick="setBestSort('${o.key}')">${o.label}</div>
    `).join('');
}

function setBestSort(key) {
    _bestSortKey = key;
    _bestPage = 15;
    renderSortPills();
    renderBestAds();
}

function getAdMetric(ad, key) {
    const ins = ad.insights?.data?.[0];
    if (!ins) return 0;
    if (key==='results') {
        const RESULT_TYPES = ['lead','offsite_conversion.fb_pixel_purchase','omni_purchase','onsite_conversion.messaging_first_reply','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead','purchase'];
        return (ins.actions||[]).filter(a=>RESULT_TYPES.includes(a.action_type)).reduce((s,a)=>s+(parseFloat(a.value)||0),0);
    }
    if (key==='clicks') return parseFloat(ins.outbound_clicks?.[0]?.value||ins.clicks) || 0;
    return parseFloat(ins[key]) || 0;
}

function renderBestAds() {
    _sortedBestAds = [..._bestAds]
        .filter(a => a.insights?.data?.length > 0)
        .sort((a,b) => getAdMetric(b,_bestSortKey)-getAdMetric(a,_bestSortKey));

    const visible = _sortedBestAds.slice(0, _bestPage);
    $('bestLoadMore').style.display = _sortedBestAds.length > _bestPage ? 'flex' : 'none';

    if (!visible.length) {
        $('bestAdsGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px;font-size:14px">Sem anúncios com dados no período</div>`;
        return;
    }

    $('bestAdsGrid').innerHTML = visible.map((ad, idx) => {
        const ins = ad.insights?.data?.[0];
        const spend = parseFloat(ins?.spend)||0;
        const creative = ad.creative || {};
        const isVideo = creative.object_type === 'VIDEO' || !!creative.video_id;
        // Imagens: full-res primeiro; vídeos: HD server-side > thumbnail_url > image_url
        const thumb = isVideo
            ? (creative._hd_thumbnail || creative.thumbnail_url || creative.image_url || '')
            : (creative.image_url || creative.thumbnail_url || '');
        const videoId = creative.video_id || '';
        const metricVal = getAdMetric(ad, _bestSortKey);
        const metricLabel = SORT_OPTS.find(o=>o.key===_bestSortKey)?.label || _bestSortKey;

        const thumbHtml = thumb
            ? `<img class="ad-card-thumb" src="${esc(thumb)}" alt="" loading="lazy"
                  id="adthumb-${idx}"
                  onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
                  onclick="abrirMedia(${idx})">
               <div class="ad-card-thumb-placeholder" style="display:none" onclick="abrirMedia(${idx})">🖼</div>`
            : `<div class="ad-card-thumb-placeholder" onclick="abrirMedia(${idx})">🖼</div>`;

        const campName = ad.campaign?.name || '';
        const adsetName = ad.adset?.name || '';

        const leads      = getAct(ins, ['lead','offsite_conversion.lead']);
        const msgs       = getAct(ins, ['onsite_conversion.messaging_conversation_started_7d']);
        const clicks     = getAct(ins, ['link_click']);
        const freq       = parseFloat(ins?.frequency)||0;
        const cpm        = parseFloat(ins?.cpm)||0;
        const cpc        = parseFloat(ins?.cpc)||0;
        const ctr        = parseFloat(ins?.ctr)||0;

        return `<div class="ad-card">
            <div style="position:relative">
                ${thumbHtml}
                <div class="ad-card-rank">#${idx+1}</div>
                ${isVideo ? `<div class="ad-card-play" onclick="abrirMedia(${idx})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="white" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>` : ''}
            </div>
            <div class="ad-card-body">
                <div class="ad-card-metric-badge">${metricLabel}: ${_bestSortKey==='spend'?fmtBRL(metricVal):fmt(metricVal,2)}</div>
                <div class="ad-card-name">${esc(ad.name)}</div>
                ${campName ? `<div class="ad-card-path">${esc(campName)}${adsetName?' › '+adsetName:''}</div>` : ''}
                <div class="ad-card-metrics">
                    <div><div class="ad-card-metric-lbl">Gasto</div><div class="ad-card-metric-val">${spend>0?fmtBRL(spend):'—'}</div></div>
                    <div><div class="ad-card-metric-lbl">Impressões</div><div class="ad-card-metric-val">${fmt(ins?.impressions)}</div></div>
                    <div><div class="ad-card-metric-lbl">Alcance</div><div class="ad-card-metric-val">${fmt(ins?.reach)}</div></div>
                    <div><div class="ad-card-metric-lbl">Frequência</div><div class="ad-card-metric-val">${freq?freq.toFixed(2):'—'}</div></div>
                    <div><div class="ad-card-metric-lbl">Cliques</div><div class="ad-card-metric-val">${fmt(clicks)}</div></div>
                    <div><div class="ad-card-metric-lbl">CTR</div><div class="ad-card-metric-val">${ctr?ctr.toFixed(2)+'%':'—'}</div></div>
                    <div><div class="ad-card-metric-lbl">CPM</div><div class="ad-card-metric-val">${cpm?fmtBRL(cpm):'—'}</div></div>
                    <div><div class="ad-card-metric-lbl">CPC</div><div class="ad-card-metric-val">${cpc?fmtBRL(cpc):'—'}</div></div>
                    <div><div class="ad-card-metric-lbl">Leads</div><div class="ad-card-metric-val">${fmt(leads)}</div></div>
                    <div><div class="ad-card-metric-lbl">CPL</div><div class="ad-card-metric-val">${leads?fmtBRL(spend/leads):'—'}</div></div>
                    <div><div class="ad-card-metric-lbl">Conversas</div><div class="ad-card-metric-val">${fmt(msgs)}</div></div>
                    <div><div class="ad-card-metric-lbl">CPR</div><div class="ad-card-metric-val">${msgs?fmtBRL(spend/msgs):'—'}</div></div>
                </div>
            </div>
        </div>`;
    }).join('');

    // Lazy-load thumbnails HD para vídeos em background
    carregarThumbsHD(visible);
}

function mostrarMaisAnuncios() {
    _bestPage += 15;
    renderBestAds();
}


async function carregarThumbsHD(visible) {
    const videoAds = visible
        .map((ad, idx) => ({ ad, idx }))
        .filter(({ ad }) => {
            const creative = ad.creative || {};
            // Só chama API se video_id existe E é numérico
            return /^\d+$/.test(creative.video_id || '');
        });

    if (!videoAds.length) return;

    // Batches de 5 para não sobrecarregar
    for (let i = 0; i < videoAds.length; i += 5) {
        const batch = videoAds.slice(i, i + 5);
        await Promise.all(batch.map(async ({ ad, idx }) => {
            const videoId = ad.creative.video_id;
            // Pula se já tiver em cache
            if (_videoDataMap[videoId]) {
                const img = $(`adthumb-${idx}`);
                if (img && _videoDataMap[videoId].thumbnail) img.src = _videoDataMap[videoId].thumbnail;
                return;
            }
            try {
                const resp = await fetch(`/api/share-video?token=${TOKEN}&videoId=${encodeURIComponent(videoId)}&adId=${encodeURIComponent(ad.id)}`);
                if (!resp.ok) return;
                const data = await resp.json();
                if (data.error) return;
                _videoDataMap[videoId] = { source: data.source || null, thumbnail: data.thumbnail || null, permalink_url: data.permalink_url || null };
                const existing = $(`adthumb-${idx}`) || document.querySelector(`[onclick="abrirMedia(${idx})"].ad-card-thumb-placeholder`);
                if (existing) {
                    const aplicarImg = (src) => {
                        const newImg = document.createElement('img');
                        newImg.className = 'ad-card-thumb';
                        newImg.id = `adthumb-${idx}`;
                        newImg.src = src;
                        newImg.setAttribute('onclick', `abrirMedia(${idx})`);
                        (existing.isConnected ? existing : $(`adthumb-${idx}`) || existing).replaceWith(newImg);
                    };
                    if (data.source) {
                        const vid = document.createElement('video');
                        vid.className = 'ad-card-thumb';
                        vid.id = `adthumb-${idx}`;
                        vid.src = data.source;
                        if (data.thumbnail) vid.poster = data.thumbnail;
                        vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
                        vid.style.cursor = 'pointer';
                        vid.setAttribute('onclick', `abrirMedia(${idx})`);
                        vid.addEventListener('loadedmetadata', () => { vid.currentTime = 1; }, { once: true });
                        existing.replaceWith(vid);
                    } else if (data.thumbnail) {
                        if (existing.tagName === 'IMG') { existing.src = data.thumbnail; }
                        else aplicarImg(data.thumbnail);
                    }
                }
            } catch { /* silencia erros individuais */ }
        }));
    }
}

// ── Media Modal ───────────────────────────────────────────────────────────
async function abrirMedia(idx) {
    const ad = _sortedBestAds[idx];
    if (!ad) return;
    const creative = ad.creative || {};
    const isVideo = creative.object_type === 'VIDEO' || !!creative.video_id;
    const name = ad.name;
    const overlay = $('mediaOverlay');
    const content = $('mediaContent');
    $('mediaName').textContent = name;
    overlay.classList.add('open');

    if (!isVideo) {
        const imgUrl = creative.image_url || creative.thumbnail_url || '';
        content.innerHTML = `<img class="ad-media-img" src="${esc(imgUrl)}" alt="${esc(name)}">`;
        return;
    }

    const videoId = creative.video_id;
    const hdThumb = creative.thumbnail_url || creative.image_url || '';

    if (!videoId) {
        content.innerHTML = `<img class="ad-media-img" src="${esc(hdThumb)}" alt="${esc(name)}">`;
        return;
    }

    // Se já temos em cache (carregarThumbsHD já buscou), usa direto
    let cached = _videoDataMap[videoId];
    if (cached?.source) {
        _mostrarVideoPlayer(content, cached.source, cached.thumbnail || hdThumb);
        return;
    }

    // Mostra thumbnail + spinner enquanto busca
    content.innerHTML = `
        <div style="position:relative;display:flex;align-items:center;justify-content:center;background:#111;border-radius:10px;width:min(90vw,600px);min-height:280px;overflow:hidden">
            ${hdThumb ? `<img src="${esc(hdThumb)}" style="width:100%;height:auto;opacity:0.55;display:block">` : '<div style="min-height:280px"></div>'}
            <div style="position:absolute;display:flex;flex-direction:column;align-items:center;gap:10px;color:#fff">
                <div style="width:36px;height:36px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></div>
                <span style="font-size:12px;opacity:.7">Carregando vídeo…</span>
            </div>
        </div>`;

    if (!cached) {
        try {
            const resp = await fetch(`/api/share-video?token=${TOKEN}&videoId=${encodeURIComponent(videoId)}&adId=${encodeURIComponent(ad.id)}`);
            const data = await resp.json();
            if (!data.error) {
                _videoDataMap[videoId] = { source: data.source || null, thumbnail: data.thumbnail || null, permalink_url: data.permalink_url || null };
                cached = _videoDataMap[videoId];
            }
        } catch { /* ignora */ }
    }

    if (!overlay.classList.contains('open')) return;

    const source = cached?.source;
    const finalThumb = cached?.thumbnail || hdThumb;
    const permalink = cached?.permalink_url;
    const adId = ad.id;

    if (source) {
        _mostrarVideoPlayer(content, source, finalThumb);
    } else {
        // Tenta preview oficial da Meta (mesmo mecanismo do app autenticado)
        let previewBody = null;
        if (adId) {
            try {
                const pr = await fetch(`/api/share-preview?token=${TOKEN}&adId=${encodeURIComponent(adId)}`);
                const pd = await pr.json();
                if (!pd.error && pd.body) previewBody = pd.body;
            } catch { /* ignora */ }
        }

        if (!overlay.classList.contains('open')) return;

        if (previewBody) {
            content.innerHTML = `<div class="ad-media-preview-wrap">${previewBody}</div>`;
            const iframe = content.querySelector('iframe');
            if (iframe) iframe.style.cssText = 'border:none;border-radius:10px;display:block;max-width:100%;';
        } else if (permalink) {
            const embedSrc = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(permalink)}&show_text=0&mute=0`;
            content.innerHTML = `
                <iframe
                    src="${embedSrc}"
                    style="width:100%;aspect-ratio:16/9;border:none;border-radius:8px;background:#000;"
                    allowfullscreen
                    allow="autoplay; clipboard-write; encrypted-media; picture-in-picture">
                </iframe>`;
        } else {
            const fbLink = videoId ? `https://www.facebook.com/watch/?v=${videoId}` : null;
            content.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;text-align:center">
                    ${finalThumb ? `<img src="${esc(finalThumb)}" style="max-width:300px;border-radius:8px;opacity:.8">` : ''}
                    <div style="color:rgba(255,255,255,.7);font-size:13px">Vídeo não disponível para reprodução direta</div>
                    ${fbLink ? `<a href="${fbLink}" target="_blank" style="background:#3b82f6;color:#fff;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">Ver no Facebook ↗</a>` : ''}
                </div>`;
        }
    }
}

function _mostrarVideoPlayer(content, source, poster) {
    const vid = document.createElement('video');
    vid.className = 'ad-media-video';
    vid.src = source;
    vid.controls = true;
    vid.autoplay = true;
    vid.preload = 'auto';
    vid.playsInline = true;
    if (poster) vid.poster = poster;
    vid.onerror = () => {
        content.innerHTML = `<div style="color:rgba(255,255,255,.7);padding:40px;text-align:center;font-size:14px">
            Não foi possível reproduzir.<br>
            <a href="${esc(source)}" target="_blank" style="color:#60a5fa;margin-top:8px;display:inline-block">Abrir link direto ↗</a>
        </div>`;
    };
    content.innerHTML = '';
    content.appendChild(vid);
}

function fecharMedia(e) {
    if (e.target === $('mediaOverlay')) fecharMediaBtn();
}

function fecharMediaBtn() {
    $('mediaOverlay').classList.remove('open');
    $('mediaContent').innerHTML = '';
}

document.addEventListener('keydown', e => { if (e.key==='Escape') fecharMediaBtn(); });

// ── Funil de Conversão ──────────────────────────────────────────────────────
const FUNIL_DEF = [
    { key:'imps',   label:'Impressões',     cost:'por impressão', color:'#3b82f6', on:true  },
    { key:'reach',  label:'Alcance',         cost:'por pessoa',    color:'#0ea5e9', on:false },
    { key:'clicks', label:'Cliques',         cost:'por clique',    color:'#8b5cf6', on:true  },
    { key:'lpv',    label:'Visitas destino', cost:'por visita',    color:'#ec4899', on:false },
    { key:'leads',  label:'Leads',           cost:'por lead',      color:'#10b981', on:true  },
    { key:'msgs',   label:'Conversas WA',    cost:'por conversa',  color:'#f59e0b', on:true  },
];
let funilMetricas = FUNIL_DEF.map(m => ({...m}));
let _funilData = {};

function renderFunil() {
    const view = $('funil-view');
    if (!view) return;
    const steps = funilMetricas.filter(m => m.on);
    const spend = _funilData.spend || 0;
    let html = spend > 0
        ? `<div class="funil-spend-badge">Valor Investido: ${fmtBRL(spend)}</div>`
        : '';
    html += '<div class="funil-tri-wrap">';
    steps.forEach((m, i) => {
        const v    = _funilData[m.key] || 0;
        const wpct = steps.length <= 1 ? 100 : Math.round(100 - (i / (steps.length - 1)) * 54);
        const custo = spend > 0 && v > 0 ? `${fmtBRL(spend/v)} ${m.cost}` : '—';
        if (i > 0) {
            const prev = _funilData[steps[i-1].key] || 0;
            const rate = prev > 0 ? (v/prev*100).toFixed(1)+'% Conversão' : '—';
            html += `<div class="funil-tri-rate">${rate}</div>`;
        }
        html += `<div class="funil-trap" style="width:${wpct}%;background:${m.color};">
            <div class="funil-trap-top">
                <span class="funil-trap-label">${m.label}</span>
                <span class="funil-trap-num">${v ? fmt(v) : '—'}</span>
                <button class="funil-trap-x" onclick="removeFunilStep('${m.key}')">×</button>
            </div>
            <div class="funil-trap-cost">${custo}</div>
        </div>`;
    });
    html += '</div>';
    view.innerHTML = html;
    _renderFunilDropdown();
}

function removeFunilStep(key) {
    const m = funilMetricas.find(x => x.key === key);
    if (!m) return;
    if (funilMetricas.filter(x => x.on).length <= 1) return;
    m.on = false;
    renderFunil();
}

function toggleFunilDropdown() {
    const dd = $('funil-dropdown');
    if (!dd) return;
    dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
}

function _renderFunilDropdown() {
    const dd = $('funil-dropdown');
    if (!dd) return;
    const off = funilMetricas.filter(m => !m.on);
    if (!off.length) { dd.innerHTML = '<div style="padding:8px 14px;font-size:12px;color:var(--muted);">Todas as etapas ativas</div>'; return; }
    dd.innerHTML = off.map(m => `
        <div class="funil-dd-item" onclick="addFunilStep('${m.key}')">
            <span class="funil-dd-dot" style="background:${m.color}"></span>${m.label}
        </div>`).join('');
}

function addFunilStep(key) {
    const m = funilMetricas.find(x => x.key === key);
    if (m) m.on = true;
    renderFunil();
    const dd = $('funil-dropdown');
    if (dd) dd.style.display = 'none';
}
