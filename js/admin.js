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
        if (!r.ok || data.error) throw new Error(data.error || 'Erro ao criar cliente');

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
    const url = window.location.origin + '/login.html';
    navigator.clipboard.writeText(`Portal Adlytics\nURL: ${url}\nE-mail: ${email}\nSenha: ${senha}`)
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
    ['dados','meta','venda'].forEach(t => {
        $('editPanel-' + t).style.display = t === tab ? '' : 'none';
        const btn = $('editTab-' + t);
        btn.style.background = t === tab ? 'var(--blue)' : 'transparent';
        btn.style.color      = t === tab ? '#fff' : 'var(--text-muted)';
    });
}

function abrirEditCliente(id) {
    switchEditTab('dados');
    const c = (window._clientesMap || {})[id] || { id };
    $('editCliId').value        = c.id;
    $('editCliNome').value      = c.nome || '';
    $('editCliPixel').value     = c.pixel_padrao || '';
    $('editCliToken').value     = c.token_meta || '';
    $('editCliAccountId').value = c.account_id || '';
    $('editCliTemplate').value  = c.template_venda || '';
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
        template_venda: $('editCliTemplate').value.trim() || undefined,
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
        if (!r.ok || data.error) throw new Error(data.error || 'Erro ao salvar');
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

function setWaView(view) {
    if (waPollTimer) clearInterval(waPollTimer);
    ['waList','waCreate','waQrView','waConnectedView'].forEach(id => {
        const el = $(id); if (el) el.style.display = 'none';
    });
    const target = $(view); if (target) target.style.display = view === 'waList' || view === 'waCreate' ? 'block' : 'block'; // block/flex
    $('btnNovaConexao').style.display = view === 'waList' ? 'flex' : 'none';
}

async function carregarListaWa() {
    setWaView('waList');
    // Mostrar botão "Conectar Existente" só para admin
    const _waUser = JSON.parse(localStorage.getItem('adlytics_user') || '{}');
    const btnExist = $('btnConectarExistente');
    if (btnExist) btnExist.style.display = _waUser.is_admin ? 'flex' : 'none';

    const listEl = $('waList');
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">Carregando conexões...</div>';
    
    try {
        const r = await authFetch('/api/evo-manager?action=list');
        const data = await r.json();
        
        if (!r.ok || data.error) throw new Error(data.error || 'Erro ao listar');
        
        if (!data || data.length === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:40px;background:var(--tag);border-radius:10px;color:var(--muted);">Nenhuma conexão configurada.<br><button class="btn btn-primary" style="margin-top:15px;" onclick="mostrarWaCriar()">Criar Conexão</button></div>';
            return;
        }

        const _waUser2 = JSON.parse(localStorage.getItem('adlytics_user') || '{}');
        const isAdminView = !!_waUser2.is_admin;

        // Card compacto para cada instância
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
            // Agrupa por cliente
            const groups = {};
            for (const inst of data) {
                const key = inst.cliente_id ? String(inst.cliente_id) : 'admin';
                if (!groups[key]) groups[key] = { nome: inst.cliente_nome || (key === 'admin' ? 'Administrador' : `Cliente #${key}`), instances: [] };
                groups[key].instances.push(inst);
            }
            // Admin primeiro, depois clientes ordenados por nome
            const keys = Object.keys(groups).sort((a, b) => {
                if (a === 'admin') return -1;
                if (b === 'admin') return 1;
                return groups[a].nome.localeCompare(groups[b].nome);
            });
            for (const key of keys) {
                const g = groups[key];
                const totalUp = g.instances.filter(i => i.state === 'open').length;
                html += `
                <div style="margin-bottom:18px;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <span style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">${esc(g.nome)}</span>
                        <span style="font-size:11px;color:var(--muted);background:var(--tag);padding:1px 8px;border-radius:20px;">${g.instances.length} instância${g.instances.length !== 1 ? 's' : ''}</span>
                        ${totalUp > 0 ? `<span style="font-size:11px;color:#10b981;">${totalUp} conectada${totalUp !== 1 ? 's' : ''}</span>` : ''}
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">
                        ${g.instances.map(renderWaCard).join('')}
                    </div>
                </div>`;
            }
        } else {
            // Cliente: grid simples sem agrupamento
            html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">${data.map(renderWaCard).join('')}</div>`;
        }

        listEl.innerHTML = html;
        lucide.createIcons({ nodes: [listEl] });

    } catch(e) {
        listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);">Erro: ${esc(e.message)}</div>`;
    }
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
        setTimeout(carregarListaWa, 800);
    } catch(e) { toast('Erro ao excluir: ' + e.message, 'error'); }
}

async function checkWaStatus(fetchQrIfNotOpen = false) {
    if (!currentWaInstance) return;
    try {
        const r = await authFetch(`/api/evo-manager?action=status&instanceName=${encodeURIComponent(currentWaInstance)}`);
        const data = await r.json();
        const state = data?.instance?.state || data?.state;
        const isConnected = state === 'open';
        
        if (isConnected) {
            if (waPollTimer) { clearInterval(waPollTimer); waPollTimer = null; }
            toast(`✅ WhatsApp conectado: ${currentWaInstance}`, 'success');
            setTimeout(carregarListaWa, 1200);
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
        if (waPollTimer) clearInterval(waPollTimer);
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
            
            if (waPollTimer) clearInterval(waPollTimer);
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
        setTimeout(carregarListaWa, 1500);
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
        setTimeout(carregarListaWa, 600);
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

function abrirLogJson(dataStr) {
    try {
        const formatted = JSON.stringify(JSON.parse(dataStr), null, 2);
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;max-width:700px;width:100%;max-height:80vh;display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);">
                <span style="font-weight:600;font-size:14px;">Dados do Log</span>
                <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:20px;">×</button>
            </div>
            <pre style="overflow:auto;padding:20px;margin:0;font-size:12px;color:var(--text);white-space:pre-wrap;word-break:break-all;">${esc(formatted)}</pre>
        </div>`;
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
    } catch(_) {}
}

let _logPage = 1;
const _logPerPage = 50;
let _logAutoRefreshId = null;

function toggleLogAutoRefresh() {
    if ($('log-auto-refresh').checked) {
        _logAutoRefreshId = setInterval(() => carregarLogs(true), 15000);
    } else {
        clearInterval(_logAutoRefreshId);
        _logAutoRefreshId = null;
    }
}

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
    const level    = document.getElementById('log-filter-level')?.value    || '';
    const tag      = document.getElementById('log-filter-tag')?.value      || '';
    const instance = document.getElementById('log-filter-instance')?.value || '';
    const search   = document.getElementById('log-filter-search')?.value   || '';
    const dateFrom = document.getElementById('log-filter-date-from')?.value || '';
    const dateTo   = document.getElementById('log-filter-date-to')?.value   || '';
    const tbody = $('logs-tbody');
    if (!tbody) return;
    if (!silent) tbody.innerHTML = '<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--muted);">Carregando...</td></tr>';

    const offset = (_logPage - 1) * _logPerPage;
    let url = `/api/logs?limit=${_logPerPage}&offset=${offset}`;
    if (level)    url += `&level=${encodeURIComponent(level)}`;
    if (tag)      url += `&tag=${encodeURIComponent(tag)}`;
    if (instance) url += `&instance=${encodeURIComponent(instance)}`;
    if (search)   url += `&search=${encodeURIComponent(search)}`;
    if (dateFrom) url += `&date_from=${encodeURIComponent(dateFrom)}`;
    if (dateTo)   url += `&date_to=${encodeURIComponent(dateTo)}`;

    try {
        const r    = await authFetch(url);
        const data = await r.json();
        const logs  = data.rows || data;
        const total = data.total ?? logs.length;

        // Stats
        const statsEl = $('log-stats');
        if (statsEl) {
            const infoCount = logs.filter(l => l.level === 'info').length;
            const warnCount = logs.filter(l => l.level === 'warn').length;
            statsEl.innerHTML = `
                <span>Total: <strong style="color:var(--text);">${total}</strong></span>
                <span>Página: <strong style="color:var(--text);">${_logPage}</strong> de <strong style="color:var(--text);">${Math.max(1, Math.ceil(total / _logPerPage))}</strong></span>
                <span style="color:#10b981;">✓ ${infoCount} info</span>
                <span style="color:#f59e0b;">⚠ ${warnCount} aviso</span>
            `;
        }

        if (!Array.isArray(logs) || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted);">Nenhum log encontrado.</td></tr>';
            renderLogPagination(total);
            return;
        }

        tbody.innerHTML = logs.map(l => {
            const tc   = LOG_TAG_COLORS[l.tag] || { bg:'rgba(156,163,175,.12)', color:'#9ca3af' };
            const isWarn = l.level === 'warn';
            const dt   = l.created_at ? new Date(l.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '-';
            const dataStr = l.data ? JSON.stringify(l.data) : '';
            const dataShort = dataStr.length > 60 ? dataStr.substring(0, 60) + '…' : dataStr;
            const dataCell = dataStr
                ? `<td style="padding:8px 10px;font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    <span onclick="abrirLogJson(${JSON.stringify(dataStr).replace(/"/g,'&quot;')})" style="cursor:pointer;color:#60a5fa;text-decoration:underline dotted;" title="Clique para ver completo">${esc(dataShort)}</span>
                  </td>`
                : `<td style="padding:8px 10px;color:var(--muted);font-size:11px;">—</td>`;
            return `<tr style="border-bottom:1px solid var(--border);${isWarn ? 'background:rgba(245,158,11,.04)' : ''}">
                <td style="padding:8px 10px;color:var(--muted);white-space:nowrap;">${dt}</td>
                <td style="padding:8px 10px;"><span style="font-size:11px;color:var(--text);">${esc(l.instance||'-')}</span></td>
                <td style="padding:8px 10px;">
                    <span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:${tc.bg};color:${tc.color};">${esc(l.tag)}</span>
                </td>
                <td style="padding:8px 10px;">
                    <span style="font-size:11px;font-weight:600;color:${isWarn ? '#f59e0b' : '#10b981'};">${isWarn ? '⚠ aviso' : '✓ info'}</span>
                </td>
                <td style="padding:8px 10px;color:var(--text);">${esc(l.message)}</td>
                ${dataCell}
            </tr>`;
        }).join('');
        renderLogPagination(total);
        lucide.createIcons({ nodes: [tbody] });
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:30px;text-align:center;color:#ef4444;">Erro ao carregar logs: ${esc(e.message)}</td></tr>`;
    }
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
