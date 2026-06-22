// ── Admin: Clientes/Agências (SaaS) ────────────────────────────
function abrirModalAddCliente() {
    $('novoCliNome').value = '';
    $('novoCliPixel').value = '';
    $('novoCliEmail').value = '';
    $('novoCliSenha').value = '';
    $('modalAddCliente').classList.add('open');
}

async function salvarNovoCliente() {
    const nome = $('novoCliNome').value.trim();
    const pixel_padrao = $('novoCliPixel').value.trim();
    const email_contato = $('novoCliEmail').value.trim();
    const senha_acesso = $('novoCliSenha').value;

    if (!nome) { toast('Nome da empresa é obrigatório!', 'error'); return; }
    if (!pixel_padrao) { toast('Pixel Padrão é obrigatório — cada cliente tem seu próprio pixel!', 'error'); return; }
    if (!email_contato) { toast('E-mail de acesso é obrigatório!', 'error'); return; }
    if (!senha_acesso || senha_acesso.length < 6) { toast('Senha deve ter no mínimo 6 caracteres!', 'error'); return; }

    const btn = $('btnSalvarCliente');
    const originalText = btn.textContent;
    btn.textContent = 'Salvando...'; btn.disabled = true;

    try {
        const r = await authFetch('/api/clientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, email_contato, pixel_padrao, senha_acesso })
        });
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || `Erro ao criar cliente (HTTP ${r.status})`);

        $('modalAddCliente').classList.remove('open');
        // Limpar campos
        ['novoCliNome','novoCliPixel','novoCliEmail','novoCliSenha'].forEach(id => { const el = $(id); if(el) el.value = ''; });
        // Mostrar modal de credenciais
        $('credEmail').textContent = email_contato;
        $('credSenha').textContent = senha_acesso;
        $('modalCredenciais').classList.add('open');
        carregarClientesAdmin();
    } catch(e) {
        toast(e.message, 'error');
    } finally {
        btn.textContent = originalText; btn.disabled = false;
    }
}

function copiarCredenciais() {
    const email = $('credEmail').textContent;
    const senha = $('credSenha').textContent;
    const brand = window.BRAND_NAME || 'Adlytics';
    const url = window.location.origin + '/login.html';
    navigator.clipboard.writeText(`Portal ${brand}\nURL: ${url}\nE-mail: ${email}\nSenha: ${senha}`)
        .then(() => toast('Credenciais copiadas!', 'success'))
        .catch(() => toast('Não foi possível copiar automaticamente', 'error'));
}

async function carregarClientesAdmin() {
    const tbody = $('tabela-clientes-admin');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted);">Carregando...</td></tr>';

    try {
        const r = await authFetch('/api/clientes');
        const clientes = await r.json();
        if (!r.ok || clientes.error) throw new Error(clientes?.error || 'Erro de API');

        if (!Array.isArray(clientes) || clientes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted);">Nenhum cliente cadastrado.</td></tr>';
            return;
        }

        const PERM_LABELS = { leads:'Leads', anuncios:'Meta Ads', relatorios:'Relatórios', whatsapp:'WhatsApp', config:'Integrações', clientes:'Compartilhar' };

        // Armazena dados completos em memória — token_meta nunca entra no HTML
        window._clientesMap = {};
        clientes.forEach(c => { window._clientesMap[c.id] = c; });

        tbody.innerHTML = clientes.map(c => {
            const p = c.permissoes || { leads:true, anuncios:true, relatorios:true, whatsapp:true, config:true, clientes:true };
            const badges = Object.entries(PERM_LABELS).map(([k, label]) =>
                `<span style="display:inline-block;font-size:10px;padding:2px 6px;border-radius:4px;margin:1px;background:${p[k] ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.1)'};color:${p[k] ? 'var(--blue)' : 'var(--red)'};">${label}</span>`
            ).join('');
            return `
            <tr>
                <td style="color:var(--muted);font-size:13px;">#${c.id}</td>
                <td style="font-weight:600;color:var(--text);">${esc(c.nome)}</td>
                <td style="font-size:13px;color:var(--muted);">${c.email_contato ? esc(c.email_contato) : '—'}</td>
                <td style="font-family:monospace;font-size:12px;color:var(--muted);">${c.pixel_padrao ? esc(c.pixel_padrao) : '—'}</td>
                <td style="max-width:200px;">${badges}</td>
                <td style="font-size:12px;color:var(--muted);">${new Date(c.criado_em).toLocaleDateString('pt-BR')}</td>
                <td style="display:flex;gap:6px;align-items:center;">
                    <button class="btn btn-ghost btn-sm" onclick="abrirEditCliente(${c.id})"><i data-lucide="edit-3" style="width:14px;"></i> Editar</button>
                    <button class="btn btn-ghost btn-sm" onclick="excluirCliente(${c.id}, '${esc(c.nome)}')" style="color:var(--red);border-color:rgba(239,68,68,0.2);"><i data-lucide="trash-2" style="width:14px;"></i></button>
                </td>
            </tr>`;
        }).join('');

        lucide.createIcons({ nodes: [tbody] });

    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);text-align:center;padding:20px;">Erro: ${esc(e.message)}</td></tr>`;
        toast('Falha ao carregar clientes: ' + e.message, 'error');
    }
}

function switchEditTab(tab) {
    ['dados','meta','venda','jornada'].forEach(t => {
        const panel = $('editPanel-' + t);
        if (panel) panel.style.display = t === tab ? '' : 'none';
        const btn = $('editTab-' + t);
        if (!btn) return;
        btn.style.background = t === tab ? 'var(--blue)' : 'transparent';
        btn.style.color      = t === tab ? '#fff' : 'var(--text-muted)';
    });
    if (tab === 'jornada') jornadaCarregar();
}

// ── Jornada do Lead: CRUD de etapas de conversão (por cliente) ───────────────
let _jornadaEtapas = [];

const JORNADA_EVENTO_LABEL = {
    lead: 'Lead', qualified: 'Qualificação', appointment: 'Agendamento',
    checkout: 'Checkout', purchase: 'Compra',
};

async function jornadaCarregar() {
    const lista = $('jornadaLista');
    if (!lista) return;
    const clienteId = $('editCliId').value;
    if (!clienteId) { lista.innerHTML = '<p style="font-size:12px;color:var(--muted);">Salve o cliente primeiro.</p>'; return; }
    lista.innerHTML = '<p style="font-size:12px;color:var(--muted);">Carregando…</p>';
    jornadaCancelarForm();
    try {
        const r = await authFetch(`/api/journey-stages?cliente_id=${clienteId}`);
        _jornadaEtapas = await r.json();
        if (!Array.isArray(_jornadaEtapas) || !_jornadaEtapas.length) {
            lista.innerHTML = '<p style="font-size:12px;color:var(--muted);">Nenhuma etapa configurada. Crie a primeira abaixo.</p>';
            return;
        }
        lista.innerHTML = _jornadaEtapas.map(e => `
            <div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:9px 11px;background:var(--bg-primary);">
                <span style="font-size:11px;color:var(--muted);min-width:18px;">${e.position || 0}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${esc(e.name)} ${e.enabled ? '' : '<span style=\"color:var(--muted);font-weight:400;\">(inativa)</span>'}</div>
                    <div style="font-size:11px;color:var(--muted);">${JORNADA_EVENTO_LABEL[e.event_concept] || e.event_concept} · ${(e.keywords||[]).join(', ') || 'sem palavra-chave'}</div>
                </div>
                <button class="btn-icon" title="Editar" onclick="jornadaEditar(${e.id})" style="background:transparent;border:none;cursor:pointer;color:var(--blue);"><i data-lucide="edit-3" style="width:15px;"></i></button>
                <button class="btn-icon" title="Excluir" onclick="jornadaExcluir(${e.id})" style="background:transparent;border:none;cursor:pointer;color:var(--red);"><i data-lucide="trash-2" style="width:15px;"></i></button>
            </div>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (e) {
        lista.innerHTML = `<p style="font-size:12px;color:var(--red);">Erro: ${esc(e.message)}</p>`;
    }
}

function jornadaNovaEtapa() {
    $('jeId').value = '';
    $('jeNome').value = '';
    $('jeConcept').value = 'purchase';
    $('jeKeywords').value = '';
    $('jeRegex').value = '';
    $('jeEnabled').checked = true;
    $('jeSalvarBtn').textContent = 'Criar etapa';
    $('jornadaForm').style.display = '';
}

function jornadaEditar(id) {
    const e = _jornadaEtapas.find(x => Number(x.id) === Number(id));
    if (!e) return;
    $('jeId').value = e.id;
    $('jeNome').value = e.name || '';
    $('jeConcept').value = e.event_concept || 'purchase';
    $('jeKeywords').value = (e.keywords || []).join(', ');
    $('jeRegex').value = e.value_regex || '';
    $('jeEnabled').checked = e.enabled !== false;
    $('jeSalvarBtn').textContent = 'Salvar etapa';
    $('jornadaForm').style.display = '';
}

function jornadaCancelarForm() {
    const f = $('jornadaForm');
    if (f) f.style.display = 'none';
}

async function jornadaSalvarEtapa() {
    const clienteId = $('editCliId').value;
    if (!clienteId) { toast('Salve o cliente primeiro.', 'error'); return; }
    const nome = $('jeNome').value.trim();
    if (!nome) { toast('Informe o nome da etapa.', 'error'); return; }
    const keywords = $('jeKeywords').value.split(',').map(k => k.trim()).filter(Boolean);
    if (!keywords.length) { toast('Informe ao menos uma palavra-chave.', 'error'); return; }
    const body = {
        cliente_id: clienteId,
        id: $('jeId').value || undefined,
        name: nome,
        event_concept: $('jeConcept').value,
        trigger_type: 'keyword',
        keywords,
        value_regex: $('jeRegex').value.trim() || null,
        position: _jornadaEtapas.length, // novo no fim; edição mantém via reorder futuro
        enabled: $('jeEnabled').checked,
    };
    // Em edição, preserva a posição original.
    if (body.id) {
        const orig = _jornadaEtapas.find(x => Number(x.id) === Number(body.id));
        if (orig) body.position = orig.position;
    }
    try {
        const r = await authFetch('/api/journey-stages', {
            method: body.id ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Falha ao salvar etapa');
        toast('Etapa salva.', 'success');
        await jornadaCarregar();
    } catch (e) {
        toast('Erro: ' + e.message, 'error');
    }
}

async function jornadaExcluir(id) {
    const clienteId = $('editCliId').value;
    if (!clienteId) return;
    try {
        const r = await authFetch(`/api/journey-stages?cliente_id=${clienteId}&id=${id}`, { method: 'DELETE' });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Falha'); }
        toast('Etapa excluída.', 'success');
        await jornadaCarregar();
    } catch (e) {
        toast('Erro: ' + e.message, 'error');
    }
}

function abrirEditCliente(id) {
    switchEditTab('dados');
    const c = (window._clientesMap || {})[id] || { id };
    $('editCliId').value        = c.id;
    $('editCliNome').value      = c.nome || '';
    $('editCliPixel').value     = c.pixel_padrao || '';
    $('editCliToken').value     = c.token_meta || '';
    $('editCliAccountId').value = c.account_id || '';
    $('editCliCapiPixel').value = c.capi_pixel_id || '';
    $('editCliCapiToken').value = ''; // nunca exibe o token (write-only)
    $('editCliTemplate').value  = c.template_venda || '';
    $('editCliTemplateQualificacao').value = c.template_qualificacao || '';
    $('editCliEmail').value     = c.email_contato || '';
    $('editCliSenha').value     = '';
    $('editCliSubtitle').textContent = c.nome || '';
    const p = c.permissoes || {};
    $('permLeads').checked      = p.leads      !== false;
    $('permAnuncios').checked   = p.anuncios   !== false;
    $('permRelatorios').checked = p.relatorios !== false;
    $('permWhatsapp').checked   = p.whatsapp   !== false;
    $('permConfig').checked     = p.config     !== false;
    $('permClientes').checked   = p.clientes   !== false;
    $('modalEditCliente').classList.add('open');
    lucide.createIcons({ nodes: [$('modalEditCliente')] });
}

async function salvarEdicaoCliente() {
    const id = parseInt($('editCliId').value);
    if (!id) return;

    const body = {
        id,
        nome:          $('editCliNome').value.trim()  || undefined,
        email_contato: $('editCliEmail').value.trim() || undefined,
        pixel_padrao:  $('editCliPixel').value.trim() || undefined,
        token_meta:    $('editCliToken').value.trim() || undefined,
        account_id:     $('editCliAccountId').value.trim() || undefined,
        capi_pixel_id:  $('editCliCapiPixel').value.trim() || undefined,
        capi_token:     $('editCliCapiToken').value.trim() || undefined,
        template_venda: $('editCliTemplate').value.trim() || undefined,
        template_qualificacao: $('editCliTemplateQualificacao').value.trim() || undefined,
        permissoes: {
            leads:      $('permLeads').checked,
            anuncios:   $('permAnuncios').checked,
            relatorios: $('permRelatorios').checked,
            whatsapp:   $('permWhatsapp').checked,
            config:     $('permConfig').checked,
            clientes:   $('permClientes').checked,
        }
    };
    const senha = $('editCliSenha').value;
    if (senha) body.senha_acesso = senha;

    const btn = $('btnSalvarEditCliente');
    const orig = btn.textContent;
    btn.textContent = 'Salvando...'; btn.disabled = true;

    try {
        const r = await authFetch('/api/clientes', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || `Erro ao salvar (HTTP ${r.status})`);
        toast('Cliente atualizado!', 'success');
        $('modalEditCliente').classList.remove('open');
        carregarClientesAdmin();
    } catch(e) {
        toast(e.message, 'error');
    } finally {
        btn.textContent = orig; btn.disabled = false;
    }
}

// ── WhatsApp / Evolution ───────────────────────────────────────
let waPollTimer;
let currentWaInstance = null;
let _waData = [];

function setWaView(view) {
    if (waPollTimer) {
        clearInterval(waPollTimer);
        waPollTimer = null;
    }
    ['waList','waCreate','waQrView','waConnectedView'].forEach(id => {
        const el = $(id); if (el) el.style.display = 'none';
    });
    const target = $(view); if (target) target.style.display = view === 'waList' || view === 'waCreate' ? 'block' : 'block'; // block/flex
    $('btnNovaConexao').style.display = view === 'waList' ? 'flex' : 'none';
}

async function carregarListaWa() {
    setWaView('waList');
    const _waUser = JSON.parse(localStorage.getItem('adlytics_user') || '{}');
    const btnExist = $('btnConectarExistente');
    if (btnExist) btnExist.style.display = _waUser.is_admin ? 'flex' : 'none';

    const listEl = $('waList');
    const buscaEl = $('waBusca');
    if (buscaEl) { buscaEl.style.display = 'none'; buscaEl.value = ''; }
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">Carregando conexões...</div>';

    try {
        const r = await authFetch('/api/evo-manager?action=list');
        const data = await r.json();

        if (!r.ok || data.error) throw new Error(data.error || `Erro ao listar conexões (HTTP ${r.status})`);

        if (!data || data.length === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:40px;background:var(--tag);border-radius:10px;color:var(--muted);">Nenhuma conexão configurada.<br><button class="btn btn-primary" style="margin-top:15px;" onclick="mostrarWaCriar()">Criar Conexão</button></div>';
            return;
        }

        _waData = data;
        const isAdminView = !!_waUser.is_admin;
        if (isAdminView && buscaEl) buscaEl.style.display = 'block';
        renderWaLista(data, isAdminView);

    } catch(e) {
        listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);">Erro: ${esc(e.message)}</div>`;
    }
}

function renderWaLista(data, isAdminView) {
    if (isAdminView === undefined) isAdminView = !!(JSON.parse(localStorage.getItem('adlytics_user') || '{}')).is_admin;
    const listEl = $('waList');

    const renderWaCard = inst => {
        const up      = inst.state === 'open';
        const mid     = inst.state === 'connecting';
        const badgeBg = up ? 'rgba(16,185,129,0.15)' : mid ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.12)';
        const badgeColor = up ? '#10b981' : mid ? '#f59e0b' : '#ef4444';
        const statusLabel = up ? '● Conectado' : mid ? '● Conectando...' : '● Desconectado';
        return `
        <div style="background:var(--card);border:1px solid ${up ? 'rgba(16,185,129,0.3)' : 'var(--border)'};border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0;">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:36px;height:36px;border-radius:9px;background:${up ? 'rgba(37,211,102,0.12)' : 'rgba(156,163,175,0.08)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid ${up ? 'rgba(37,211,102,0.2)' : 'var(--border)'};">
                    <i data-lucide="smartphone" style="color:${up ? '#25D366' : 'var(--muted)'};width:17px;"></i>
                </div>
                <div style="min-width:0;flex:1;">
                    <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(inst.displayName)}">${esc(inst.displayName)}</div>
                    <span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:${badgeBg};color:${badgeColor};margin-top:3px;">${statusLabel}</span>
                </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${up
                    ? `<button class="btn btn-ghost btn-sm" onclick="waDesvincular('${esc(inst.fullName)}')" style="font-size:11px;padding:4px 10px;color:var(--red);border-color:rgba(239,68,68,0.3);"><i data-lucide="link-2-off" style="width:11px;"></i> Desvincular</button>`
                    : `<button class="btn btn-green btn-sm" onclick="verConexao('${esc(inst.displayName)}')" style="font-size:11px;padding:4px 10px;"><i data-lucide="qr-code" style="width:11px;"></i> Conectar QR</button>`
                }
                <button class="btn btn-ghost btn-sm" onclick="abrirCaptura('${esc(inst.fullName)}', ${inst.cliente_id || 'null'})" title="Configurar captura de leads" style="font-size:11px;padding:4px 10px;"><i data-lucide="filter" style="width:11px;"></i> Captura</button>
                <button class="btn btn-ghost btn-sm" onclick="deletarConexao('${esc(inst.displayName)}')" title="Excluir" style="padding:4px 8px;"><i data-lucide="trash-2" style="width:11px;color:var(--red);"></i></button>
            </div>
            <div style="padding-top:8px;border-top:1px solid var(--border);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <code style="font-family:monospace;font-size:10px;background:var(--tag);padding:2px 6px;border-radius:4px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${esc(inst.fullName)}</code>
                ${up ? `<span style="font-size:10px;color:#10b981;white-space:nowrap;">✓ Ativo</span>` : ''}
            </div>
        </div>`;
    };

    let html = '';
    if (isAdminView) {
        const groups = {};
        for (const inst of data) {
            const key = inst.cliente_id ? String(inst.cliente_id) : 'admin';
            if (!groups[key]) groups[key] = { nome: inst.cliente_nome || (key === 'admin' ? 'Administrador' : `Cliente #${key}`), instances: [] };
            groups[key].instances.push(inst);
        }
        const keys = Object.keys(groups).sort((a, b) => {
            if (a === 'admin') return -1;
            if (b === 'admin') return 1;
            return groups[a].nome.localeCompare(groups[b].nome);
        });
        const savedState = JSON.parse(sessionStorage.getItem('wa_groups') || '{}');
        for (const key of keys) {
            const g = groups[key];
            const totalUp = g.instances.filter(i => i.state === 'open').length;
            const isOpen = !!savedState[key];
            html += `
            <div style="margin-bottom:8px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
                <div onclick="toggleWaGroup('${key}')" style="cursor:pointer;padding:12px 16px;display:flex;align-items:center;gap:10px;background:var(--tag);user-select:none;">
                    <i data-lucide="chevron-right" id="wa-chevron-${key}" style="width:14px;color:var(--muted);transition:transform .2s;flex-shrink:0;${isOpen ? 'transform:rotate(90deg);' : ''}"></i>
                    <span style="font-size:12px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.05em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(g.nome)}</span>
                    <span style="font-size:11px;color:var(--muted);background:var(--border);padding:1px 8px;border-radius:20px;flex-shrink:0;">${g.instances.length} instância${g.instances.length !== 1 ? 's' : ''}</span>
                    ${totalUp > 0 ? `<span style="font-size:11px;color:#10b981;font-weight:600;flex-shrink:0;">${totalUp} online</span>` : ''}
                </div>
                <div id="wa-group-${key}" style="display:${isOpen ? 'block' : 'none'};padding:12px;border-top:1px solid var(--border);">
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">
                        ${g.instances.map(renderWaCard).join('')}
                    </div>
                </div>
            </div>`;
        }
    } else {
        html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">${data.map(renderWaCard).join('')}</div>`;
    }

    listEl.innerHTML = html;
    lucide.createIcons({ nodes: [listEl] });
}

function toggleWaGroup(key) {
    const body = $(`wa-group-${key}`);
    const chevron = $(`wa-chevron-${key}`);
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
    const state = JSON.parse(sessionStorage.getItem('wa_groups') || '{}');
    state[key] = !open;
    sessionStorage.setItem('wa_groups', JSON.stringify(state));
}

function filtrarWa(termo) {
    if (!_waData.length) return;
    const t = termo.toLowerCase().trim();
    const filtered = t
        ? _waData.filter(i =>
            (i.cliente_nome || '').toLowerCase().includes(t) ||
            (i.displayName || '').toLowerCase().includes(t) ||
            (i.fullName || '').toLowerCase().includes(t)
          )
        : _waData;
    renderWaLista(filtered);
}

function mostrarWaCriar() {
    setWaView('waCreate');
    $('waInstanceName').value = '';
    $('waInstanceName').focus();
}

async function verConexao(name) {
    currentWaInstance = name;
    checkWaStatus(true);
}

async function deletarConexao(name) {
    if (!confirm(`Excluir permanentemente a conexão "${name}"? Isso remove da Evolution também.`)) return;
    try {
        const r = await authFetch('/api/evo-manager', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'delete', instanceName: name}) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erro ao excluir');
        toast("Conexão excluída da Evolution.", "success");
        await carregarListaWa();
    } catch(e) { toast('Erro ao excluir: ' + e.message, 'error'); }
}

async function checkWaStatus(fetchQrIfNotOpen = false) {
    if (!currentWaInstance) return;
    try {
        const r = await authFetch(`/api/evo-manager?action=status&instanceName=${encodeURIComponent(currentWaInstance)}`);
        const data = await r.json();
        const state = String(data?.instance?.state || data?.state || '').toLowerCase();
        const isConnected = ['open', 'connected', 'online'].includes(state);
        
        if (isConnected) {
            if (waPollTimer) { clearInterval(waPollTimer); waPollTimer = null; }
            setWaView('waConnectedView');
            $('waConnTitle').textContent = currentWaInstance;
            $('btnWaLogout').onclick = () => waLogout(currentWaInstance);
            toast(`WhatsApp conectado: ${currentWaInstance}`, 'success');
            if (window.lucide) lucide.createIcons({ nodes: [$('waConnectedView')] });
        } else {
            setWaView('waQrView');
            $('waQrTitle').textContent = `Conectar: ${currentWaInstance}`;
            if (fetchQrIfNotOpen) {
                $('waQrImage').style.display = 'none';
                $('waWaitQr').style.display = 'block';
                const rQR = await authFetch(`/api/evo-manager?action=connect&instanceName=${encodeURIComponent(currentWaInstance)}`);
                const qd = await rQR.json();
                if (qd.base64) {
                    $('waQrImage').src = qd.base64;
                    $('waQrImage').style.display = 'block';
                    $('waWaitQr').style.display = 'none';
                    if (!waPollTimer) waPollTimer = setInterval(() => checkWaStatus(false), 4000);
                } else if (qd?.instance?.state === 'open') {
                    checkWaStatus(false);
                }
            } else {
                if (!waPollTimer) waPollTimer = setInterval(() => checkWaStatus(false), 4000);
            }
        }
    } catch(e) {
        if (waPollTimer) {
            clearInterval(waPollTimer);
            waPollTimer = null;
        }
    }
}

async function waCreateInstance() {
    const name = $('waInstanceName').value.trim();
    if (!name) { toast('Dê um nome para a conexão', 'error'); return; }

    const btn = $('btnGerarQr');
    const old = btn.innerHTML;
    btn.innerHTML = 'Gerando...'; btn.disabled = true;

    try {
        const r = await authFetch('/api/evo-manager', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'create', instanceName: name}) });
        const data = await r.json();

        if (!r.ok || data.error) throw new Error(data.error || 'Falha ao conectar na Evolution');

        currentWaInstance = name;
        setWaView('waQrView');
        $('waQrTitle').textContent = `Conectar: ${name}`;

        if (data.base64) {
            $('waQrImage').src = data.base64;
            $('waQrImage').style.display = 'block';
            $('waWaitQr').style.display = 'none';
            toast("QR Code gerado! Aponte o celular.", "success");
            
            if (waPollTimer) {
                clearInterval(waPollTimer);
                waPollTimer = null;
            }
            waPollTimer = setInterval(() => checkWaStatus(false), 4000);
        } else if (data.instance?.state === 'open' || data.state === 'open') {
            checkWaStatus();
        } else {
            throw new Error("Não foi possível gerar a imagem Base64 do WhatsApp.");
        }
    } catch(e) {
        toast(e.message, 'error');
        setWaView('waCreate');
    } finally {
        btn.innerHTML = old; btn.disabled = false;
    }
}

async function waLogout(name) {
    if(!confirm(`Atenção: Deslogar permanentemente o aparelho conectado em "${name}"?`)) return;
    try {
        await authFetch('/api/evo-manager', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'logout', instanceName: name}) });
        toast("Sessão encerrada remotamente.", "success");
        await carregarListaWa();
    } catch(e) {
        toast("Erro ao tentar deslogar.", "error");
    }
}

async function waDesvincular(name) {
    if(!confirm(`Desvincular "${name}" do projeto?\n\nA instância continuará ativa no WhatsApp, apenas deixará de ser monitorada aqui.`)) return;
    try {
        await authFetch('/api/evo-manager', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'unlink', instanceName: name}) });
        toast("Instância desvinculada do projeto.", "success");
        carregarListaWa();
    } catch(e) {
        toast("Erro ao desvincular: " + esc(e.message), "error");
    }
}

// ── Captura de leads por instância (ctwa_only | all | keyword) ──────────────
let _capturaInstancia = null;
let _capturaClienteId = null;
let _capturaInstanciasDisponiveis = [];

function capturaResetForm() {
    $('capturaModo').value = 'ctwa_only';
    $('capturaKeywords').value = '';
    $('capturaMatch').value = 'partial';
    $('capturaDedup').value = 24;
    capturaToggleCampos();
}

async function carregarCapturaConfig(instanceName, clienteId) {
    _capturaInstancia = instanceName;
    _capturaClienteId = clienteId || null;
    $('capturaInstanciaNome').textContent = instanceName;
    capturaResetForm();

    // Carrega config existente (default ctwa_only)
    try {
        const q = new URLSearchParams({ instance_name: instanceName });
        if (_capturaClienteId) q.append('cliente_id', _capturaClienteId);
        const r = await authFetch('/api/lead-capture-settings?' + q.toString());
        const cfg = await readApiJson(r, 'Falha ao carregar configuração de captura');
        $('capturaModo').value      = cfg?.capture_mode || 'ctwa_only';
        $('capturaKeywords').value  = (cfg?.keywords || []).join(', ');
        $('capturaMatch').value     = cfg?.keyword_match || 'partial';
        $('capturaDedup').value     = cfg?.deduplication_hours ?? 24;
    } catch {
        capturaResetForm();
    }
    capturaToggleCampos();
}

async function abrirCaptura(instanceName, clienteId) {
    $('capturaInstanciaBox').style.display = 'none';
    $('modalCaptura').classList.add('open');
    await carregarCapturaConfig(instanceName, clienteId);
}

async function abrirCapturaGeral(btn) {
    const user = JSON.parse(localStorage.getItem('adlytics_user') || '{}');
    const clienteId = user.is_admin
        ? (typeof clienteAdminSelecionado !== 'undefined' ? clienteAdminSelecionado : null)
        : (user.cliente_id || null);
    if (user.is_admin && !clienteId) {
        toast('Selecione um cliente no topo do painel antes de configurar a captura.', 'error');
        return;
    }

    const original = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Carregando...'; }
    try {
        const q = new URLSearchParams({ action: 'list' });
        if (user.is_admin && clienteId) q.set('target_cliente_id', clienteId);
        const r = await authFetch('/api/evo-manager?' + q.toString());
        const data = await readApiJson(r, 'Falha ao carregar conexões WhatsApp');
        _capturaInstanciasDisponiveis = (Array.isArray(data) ? data : [])
            .filter(inst => inst.fullName && (!clienteId || Number(inst.cliente_id) === Number(clienteId)));

        if (!_capturaInstanciasDisponiveis.length) {
            toast('Nenhuma conexão WhatsApp vinculada a este cliente.', 'error');
            mudarAba('whatsapp');
            return;
        }

        if (_capturaInstanciasDisponiveis.length === 1) {
            const inst = _capturaInstanciasDisponiveis[0];
            await abrirCaptura(inst.fullName, inst.cliente_id || clienteId);
            return;
        }

        const select = $('capturaInstanciaSelect');
        select.innerHTML = '<option value="">Selecione a conexão...</option>' +
            _capturaInstanciasDisponiveis.map(inst =>
                `<option value="${esc(inst.fullName)}">${esc(inst.displayName || inst.fullName)}${inst.state === 'open' ? ' — conectada' : ' — desconectada'}</option>`
            ).join('');
        _capturaInstancia = null;
        _capturaClienteId = clienteId;
        $('capturaInstanciaNome').textContent = 'Selecione uma conexão';
        $('capturaInstanciaBox').style.display = 'block';
        capturaResetForm();
        $('modalCaptura').classList.add('open');
        lucide.createIcons({ nodes: [$('modalCaptura')] });
    } catch (e) {
        toast('Erro: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
    }
}

async function capturaSelecionarInstancia(instanceName) {
    if (!instanceName) {
        _capturaInstancia = null;
        $('capturaInstanciaNome').textContent = 'Selecione uma conexão';
        capturaResetForm();
        return;
    }
    const inst = _capturaInstanciasDisponiveis.find(i => i.fullName === instanceName);
    await carregarCapturaConfig(instanceName, inst?.cliente_id || _capturaClienteId);
}

// Mostra os campos de palavra-chave só no modo keyword.
function capturaToggleCampos() {
    const ehKeyword = $('capturaModo').value === 'keyword';
    $('capturaKeywordBox').style.display = ehKeyword ? 'block' : 'none';
}

async function salvarCaptura() {
    if (!_capturaInstancia) {
        toast('Selecione uma conexão WhatsApp.', 'error');
        return;
    }
    const btn = $('btnSalvarCaptura');
    const prev = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Salvando...';
    try {
        const keywords = $('capturaKeywords').value.split(',').map(k => k.trim()).filter(Boolean);
        if ($('capturaModo').value === 'keyword' && !keywords.length) {
            throw new Error('Informe pelo menos uma palavra-chave.');
        }
        const body = {
            instance_name: _capturaInstancia,
            capture_mode: $('capturaModo').value,
            keywords,
            keyword_match: $('capturaMatch').value,
            deduplication_hours: parseInt($('capturaDedup').value, 10) || 24,
        };
        if (_capturaClienteId) body.cliente_id = _capturaClienteId;
        const r = await authFetch('/api/lead-capture-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        await readApiJson(r, 'Falha ao salvar configuração de captura');
        toast('Captura configurada.', 'success');
        $('modalCaptura').classList.remove('open');
    } catch (e) {
        toast('Erro: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.innerHTML = prev;
    }
}

let _instanciaSelecionada = null;

async function abrirModalVincular() {
    _instanciaSelecionada = null;
    $('instanciaSelecionadaInfo').textContent = '';
    $('selectClienteVincular').innerHTML = '<option value="">Selecione o cliente...</option>';
    $('listaInstanciasEvo').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Carregando instâncias...</div>';
    $('modalVincularInstancia').classList.add('open');

    // Busca todas as instâncias da Evolution
    try {
        const [rInst, rCli] = await Promise.all([
            authFetch('/api/evo-manager?action=list-all'),
            authFetch('/api/clientes')
        ]);
        const instancias = await rInst.json();
        const clientes = await rCli.json();

        // Popula select de clientes
        $('selectClienteVincular').innerHTML = '<option value="">Selecione o cliente...</option>' +
            (clientes || []).map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');

        // Renderiza lista de instâncias
        if (!instancias.length) {
            $('listaInstanciasEvo').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Nenhuma instância encontrada na Evolution.</div>';
            return;
        }
        $('listaInstanciasEvo').innerHTML = instancias.map(inst => {
            const up = inst.state === 'open';
            const badgeColor = up ? '#10b981' : '#ef4444';
            const badgeLabel = up ? '● Conectado' : '● Desconectado';
            return `<div class="inst-item" onclick="selecionarInstancia('${esc(inst.fullName)}')"
                style="cursor:pointer;padding:10px 14px;border-radius:8px;border:1px solid var(--border);background:var(--card);display:flex;align-items:center;justify-content:space-between;transition:border .15s;"
                id="instItem_${esc(inst.fullName)}">
                <span style="font-weight:600;font-size:14px;">${esc(inst.fullName)}</span>
                <span style="font-size:11px;font-weight:600;color:${badgeColor};">${badgeLabel}</span>
            </div>`;
        }).join('');
        lucide.createIcons({ nodes: [$('listaInstanciasEvo')] });
    } catch(e) {
        $('listaInstanciasEvo').innerHTML = `<div style="color:var(--red);padding:20px;">${esc(e.message)}</div>`;
    }
}

function selecionarInstancia(name) {
    _instanciaSelecionada = name;
    // Highlight selecionado
    document.querySelectorAll('.inst-item').forEach(el => el.style.borderColor = 'var(--border)');
    const el = $('instItem_' + name);
    if (el) el.style.borderColor = '#25D366';
    $('instanciaSelecionadaInfo').textContent = `Instância selecionada: ${name}`;
}

async function confirmarVincularInstancia() {
    if (!_instanciaSelecionada) { toast('Selecione uma instância', 'error'); return; }
    const cliente_id = $('selectClienteVincular').value;
    if (!cliente_id) { toast('Selecione o cliente', 'error'); return; }

    const btn = $('btnConfirmarVincular');
    btn.textContent = 'Vinculando...'; btn.disabled = true;
    try {
        const r = await authFetch('/api/evo-manager', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'link', instanceName: _instanciaSelecionada, cliente_id: parseInt(cliente_id) })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erro ao vincular');
        toast('Instância vinculada com sucesso!', 'success');
        $('modalVincularInstancia').classList.remove('open');
        await carregarListaWa();
    } catch(e) {
        toast(e.message, 'error');
    } finally {
        btn.textContent = 'Vincular Instância'; btn.disabled = false;
    }
}

async function excluirCliente(id, nome) {
    if (!confirm(`Excluir permanentemente o cliente "${nome}"?\n\nIsso apaga o usuário de acesso e TODOS os leads vinculados.`)) return;
    try {
        const r = await authFetch('/api/clientes', { method: 'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erro ao excluir');
        toast('Cliente excluído.', 'success');
        carregarClientesAdmin();
    } catch(e) { toast(e.message, 'error'); }
}

// ── Logs do Sistema ───────────────────────────────────────────────────────────
const LOG_TAG_COLORS = {
    'recv':         { bg:'rgba(59,130,246,.15)',  color:'#60a5fa' },
    'auth':         { bg:'rgba(139,92,246,.15)',  color:'#a78bfa' },
    'filter':       { bg:'rgba(156,163,175,.12)', color:'#9ca3af' },
    'lead':         { bg:'rgba(16,185,129,.15)',  color:'#34d399' },
    'meta-api':     { bg:'rgba(14,165,233,.15)',  color:'#38bdf8' },
    'db':           { bg:'rgba(245,158,11,.12)',  color:'#fbbf24' },
    'capi-lead':    { bg:'rgba(16,185,129,.15)',  color:'#34d399' },
    'purchase':     { bg:'rgba(236,72,153,.15)',  color:'#f472b6' },
    'capi-purchase':{ bg:'rgba(236,72,153,.15)',  color:'#f472b6' },
};

async function showLogDetail(id) {
    try {
        const modal = document.createElement('div');
        modal.id = 'modal-log-detail';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);';
        modal.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;max-width:800px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);">
                <span style="font-weight:600;font-size:14px;color:var(--text);">Log ID #${id} - Detalhes Completos</span>
                <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:24px;">&times;</button>
            </div>
            <div id="modal-log-content" style="overflow:auto;padding:20px;margin:0;font-size:12px;color:#e2e8f0;white-space:pre-wrap;word-break:break-all;background:#0f172a;">
                <div style="text-align:center;padding:40px;color:var(--muted);">
                    <div class="spinner" style="margin-bottom:10px;"></div>
                    Buscando payload completo...
                </div>
            </div>
        </div>`;
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);

        const r = await authFetch(`/api/logs/${id}`);
        const log = await r.json();
        const contentEl = document.getElementById('modal-log-content');
        if (!contentEl) return;

        if (!r.ok || !log || log.error) {
            contentEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">${esc(log?.error || 'Erro ao recuperar o log.')}</div>`;
            return;
        }

        // Cabeçalho com os campos do log. `data` pode vir NULL/vazio — nesse caso
        // ainda mostramos os demais campos (antes a tela ficava preta/vazia).
        const linhas = [];
        if (log.created_at) linhas.push(`Data:      ${log.created_at}`);
        if (log.instance)   linhas.push(`Instância: ${log.instance}`);
        if (log.tag)        linhas.push(`Tag:       ${log.tag}`);
        if (log.level)      linhas.push(`Nível:     ${log.level}`);
        if (log.message)    linhas.push(`Mensagem:  ${log.message}`);

        // Normaliza o `data`: pode ser objeto, string JSON ou NULL.
        let dataStr = '';
        if (log.data != null && log.data !== '') {
            try {
                const parsed = typeof log.data === 'string' ? JSON.parse(log.data) : log.data;
                dataStr = JSON.stringify(parsed, null, 2);
            } catch {
                dataStr = String(log.data);
            }
        }

        let html = '';
        if (linhas.length) {
            html += `<pre style="margin:0 0 14px;color:#94a3b8;font-family:'Fira Code',monospace;line-height:1.6;">${esc(linhas.join('\n'))}</pre>`;
        }
        if (dataStr) {
            html += `<div style="color:#64748b;font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em;">Payload</div>`;
            html += `<pre style="margin:0;color:#e2e8f0;font-family:'Fira Code',monospace;line-height:1.5;">${esc(dataStr)}</pre>`;
        } else if (!linhas.length) {
            html = '<div style="text-align:center;padding:20px;color:var(--muted);">Este log não tem detalhes adicionais.</div>';
        }
        contentEl.innerHTML = html;
    } catch(e) {
        const contentEl = document.getElementById('modal-log-content');
        if (contentEl) contentEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Erro ao carregar: ${esc(e.message)}</div>`;
        else toast('Erro ao carregar detalhes', 'error');
    }
}

let _logPage = 1;
const _logPerPage = 50;
let _logAutoRefreshId = null;
let _logDefaultDateApplied = false;

function toggleLogAutoRefresh() {
    if ($('log-auto-refresh').checked) {
        _logAutoRefreshId = setInterval(() => {
            if (!document.hidden) carregarLogs(true);
        }, 30000);
    } else {
        clearInterval(_logAutoRefreshId);
        _logAutoRefreshId = null;
    }
}

// Pausa o polling quando a aba não está visível
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (_logAutoRefreshId) { clearInterval(_logAutoRefreshId); _logAutoRefreshId = null; }
        if (waPollTimer) { clearInterval(waPollTimer); waPollTimer = null; }
    } else {
        if ($('log-auto-refresh')?.checked && !_logAutoRefreshId) toggleLogAutoRefresh();
    }
});

function limparFiltrosLog() {
    $('log-filter-search').value = '';
    $('log-filter-instance').value = '';
    $('log-filter-date-from').value = '';
    $('log-filter-date-to').value = '';
    $('log-filter-level').value = '';
    $('log-filter-tag').value = '';
    _logPage = 1;
    carregarLogs();
}

function logMudarPagina(dir) {
    _logPage += dir;
    if (_logPage < 1) _logPage = 1;
    carregarLogs();
}

async function carregarLogs(silent) {
    // Aplica filtro padrão de 48h apenas na primeira abertura da aba
    if (!_logDefaultDateApplied) {
        _logDefaultDateApplied = true;
        const dateFromEl = $('log-filter-date-from');
        if (dateFromEl && !dateFromEl.value) {
            const d = new Date(); d.setDate(d.getDate() - 2);
            dateFromEl.value = d.toISOString().split('T')[0];
        }
    }

    const filters = [
        'log-filter-level', 'log-filter-tag', 'log-filter-instance',
        'log-filter-search', 'log-filter-date-from', 'log-filter-date-to'
    ];
    const tbody = $('logs-tbody');
    if (!tbody) return;

    if (!silent) {
        filters.forEach(id => { const el = $(id); if(el) el.disabled = true; });
        tbody.innerHTML = Array(5).fill(0).map(() => `
            <tr class="skeleton-row">
                <td colspan="6" style="padding:15px;"><div style="height:12px;background:var(--border);border-radius:4px;width:100%;opacity:0.3;animation:pulse 1.5s infinite;"></div></td>
            </tr>
        `).join('');
    }

    const params = new URLSearchParams({
        limit: _logPerPage,
        offset: (_logPage - 1) * _logPerPage,
        level: $(filters[0])?.value || '',
        tag: $(filters[1])?.value || '',
        instance: $(filters[2])?.value || '',
        search: $(filters[3])?.value || '',
        date_from: $(filters[4])?.value || '',
        date_to: $(filters[5])?.value || ''
    });

    try {
        const r = await authFetch(`/api/logs/lite?${params.toString()}`);
        const data = await r.json();
        const logs = data.logs || [];
        const total = data.total ?? logs.length;

        filters.forEach(id => { const el = $(id); if(el) el.disabled = false; });
        
        // Atualiza Stats
        const statsEl = $('log-stats');
        if (statsEl) {
            statsEl.innerHTML = `Total: <strong>${total}</strong> | Pág: <strong>${_logPage}/${Math.max(1, Math.ceil(total/_logPerPage))}</strong>`;
        }

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted);">Nenhum log encontrado.</td></tr>';
        } else {
            await renderLogs(logs);
        }
        
        renderLogPagination(total);
        lucide.createIcons({ nodes: [tbody] });

    } catch(e) {
        filters.forEach(id => { const el = $(id); if(el) el.disabled = false; });
        tbody.innerHTML = `<tr><td colspan="6" style="padding:30px;text-align:center;color:#ef4444;">Erro: ${esc(e.message)}</td></tr>`;
    }
}

async function renderLogs(logs) {
    const tbody = document.getElementById('logs-tbody');
    const fragment = document.createDocumentFragment();
    
    // Pré-processa uma vez (Performance)
    const processed = logs.map(l => ({
        ...l,
        dt: new Date(l.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }),
        color: l.level === 'error' ? '#ef4444' : l.level === 'warn' ? '#f59e0b' : '#10b981',
        preview: l.data_preview || ''
    }));
    
    processed.forEach(l => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';
        if (l.level === 'error') tr.style.background = 'rgba(239,68,68,.05)';
        
        tr.innerHTML = `
            <td style="padding:8px;font-size:12px;color:var(--muted);white-space:nowrap;">${l.dt}</td>
            <td style="padding:8px;"><span style="background:rgba(31,41,55,.5);padding:2px 6px;border-radius:4px;font-size:11px;color:var(--text);">${esc(l.instance||'-')}</span></td>
            <td style="padding:8px;"><span style="color:${l.color};font-weight:600;font-size:11px;">${l.level.toUpperCase()}</span></td>
            <td style="padding:8px;"><span style="font-size:12px;color:var(--muted)">${esc(l.tag||'')}</span></td>
            <td style="padding:8px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text);" title="${esc(l.message)}">${esc(l.message)}</td>
            <td style="padding:8px;"><button onclick="showLogDetail(${l.id})" style="font-size:11px;color:#60a5fa;background:none;border:none;cursor:pointer;text-decoration:underline;">ver</button></td>
        `;
        fragment.appendChild(tr);
    });
    
    tbody.replaceChildren(fragment);
}

function renderLogPagination(total) {
    const el = $('log-pagination');
    if (!el) return;
    const totalPages = Math.max(1, Math.ceil(total / _logPerPage));
    el.innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="logMudarPagina(-1)" ${_logPage <= 1 ? 'disabled' : ''} style="padding:5px 12px;font-size:12px;">
            ← Anterior
        </button>
        <span style="font-size:12px;color:var(--muted);">${_logPage} / ${totalPages}</span>
        <button class="btn btn-ghost btn-sm" onclick="logMudarPagina(1)" ${_logPage >= totalPages ? 'disabled' : ''} style="padding:5px 12px;font-size:12px;">
            Próxima →
        </button>
    `;
}
async function pruneLogs() {
    if (!confirm('Deseja realmente remover permanentemente todos os logs com mais de 15 dias?\nIsso ajudará a liberar espaço no banco de dados.')) return;
    
    try {
        const r = await authFetch('/api/logs-prune', { method: 'POST' });
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || 'Erro ao limpar logs');
        
        toast(data.message || 'Limpeza concluída!', 'success');
        carregarLogs();
    } catch (e) {
        toast('Erro ao limpar: ' + e.message, 'error');
    }
}
