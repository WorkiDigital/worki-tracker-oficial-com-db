// Lógica Frontend para Relatórios Automatizados (WhatsApp) - Centralizado
let relatorioGruposCache = [];

function abrirModalNovoRelatorio() {
    const instance = $('relatorioGlobalInstance').value;
    if(!instance) {
        return toast('Selecione uma instância de envio primeiro no topo da página.', 'error');
    }
    $('modalNovoRelatorio').classList.add('open');
    carregarGruposRelatorio(); // Carrega os grupos da instância selecionada no topo
}

function fecharModalNovoRelatorio() {
    $('modalNovoRelatorio').classList.remove('open');
}

function toggleRelatorioDestino() {
    const isGrupo = document.querySelector('input[name="relatorioTipoDestino"]:checked').value === 'grupo';
    $('relatorioContainerGrupo').style.display = isGrupo ? 'block' : 'none';
    $('relatorioContainerContato').style.display = isGrupo ? 'none' : 'block';
}

// Quando mudar a instância no topo, resetamos o modal e podemos salvar a preferência
function onChangeGlobalInstance() {
    const instance = $('relatorioGlobalInstance').value;
    localStorage.setItem('relatorio_pref_instance', instance);
    carregarGruposRelatorio(); // Pré-carrega grupos se o modal for aberto
}

async function carregarInstanciasRelatorio() {
    try {
        const token = localStorage.getItem('adlytics_token');
        const res = await fetch('/api/evo-manager?action=list', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Falha ao carregar instâncias');
        const instances = await res.json();
        
        const sel = $('relatorioGlobalInstance');
        sel.innerHTML = '<option value="">Selecionar número...</option>';
        
        instances.forEach(i => {
            if(i.state === 'open') {
                const opt = document.createElement('option');
                opt.value = i.fullName;
                const label = i.cliente_nome ? `${i.cliente_nome} (${i.displayName})` : i.displayName;
                opt.textContent = label;
                sel.appendChild(opt);
            }
        });

        // Tenta recuperar preferência salva
        const pref = localStorage.getItem('relatorio_pref_instance');
        if(pref && Array.from(sel.options).some(o => o.value === pref)) {
            sel.value = pref;
        } else if (sel.options.length > 1) {
            sel.selectedIndex = 1; // Seleciona a primeira disponível
        }

    } catch(e) {
        console.error(e);
        toast('Erro ao carregar instâncias.', 'error');
    }
}

async function carregarGruposRelatorio() {
    const instanceName = $('relatorioGlobalInstance').value;
    const selGroup = $('relatorioTargetGroup');
    
    if(!instanceName) return;

    selGroup.innerHTML = '<option value="">Carregando grupos...</option>';
    
    try {
        const token = localStorage.getItem('adlytics_token');
        const res = await fetch(`/api/evo-groups?instanceName=${instanceName}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Falha ao buscar grupos');
        const groups = await res.json();
        
        relatorioGruposCache = groups;
        selGroup.innerHTML = '<option value="">Selecione um grupo...</option>';
        groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            selGroup.appendChild(opt);
        });
    } catch(e) {
        console.error(e);
        selGroup.innerHTML = '<option value="">Erro ao carregar grupos</option>';
    }
}

async function carregarListaRelatorios() {
    // Primeiro garante que temos as instâncias para o topo
    if($('relatorioGlobalInstance').options.length <= 1) {
        await carregarInstanciasRelatorio();
    }

    try {
        const token = localStorage.getItem('adlytics_token');
        const res = await fetch('/api/reports-config', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if(!res.ok) return;
        const relatorios = await res.json();
        
        const tbody = $('lista-relatorios-zap');
        tbody.innerHTML = '';
        
        if(relatorios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:40px;">Nenhum relatório agendado.</td></tr>';
            return;
        }

        relatorios.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div style="font-weight:600;">${r.nome_destino}</div>
                    <div style="font-size:11px;color:var(--muted);">${r.is_group ? 'Grupo' : 'Contato'} • ${r.instance_name}</div>
                </td>
                <td style="text-transform:capitalize;">${r.frequencia}</td>
                <td>${r.horario_envio}</td>
                <td>
                    <span class="status-badge" style="background:${r.status ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color:${r.status ? '#10b981' : '#ef4444'};">
                        ${r.status ? 'Ativo' : 'Pausado'}
                    </span>
                </td>
                <td>
                    <button class="btn-icon" onclick="deletarRelatorio('${r.id}')" style="color:var(--red);" title="Excluir">
                        <i data-lucide="trash-2" style="width:16px;"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    } catch(e) {
        console.error(e);
    }
}

async function salvarRelatorioAgendado() {
    const instance_name = $('relatorioGlobalInstance').value;
    const isGroup = document.querySelector('input[name="relatorioTipoDestino"]:checked').value === 'grupo';
    const targetGroup = $('relatorioTargetGroup');
    const targetContato = $('relatorioTargetContato').value;
    
    let target_jid = isGroup ? targetGroup.value : targetContato;
    let nome_destino = isGroup ? (targetGroup.options[targetGroup.selectedIndex]?.text || '') : targetContato;
    
    if(!isGroup && target_jid && !target_jid.includes('@')) {
        target_jid = target_jid.replace(/\D/g, '') + '@s.whatsapp.net';
    }

    const checkboxes = document.querySelectorAll('.rel-metric:checked');
    const metricas = Array.from(checkboxes).map(c => c.value);
    const frequencia = $('relatorioFrequencia').value;
    const horario_envio = $('relatorioHorario').value;

    if(!instance_name || !target_jid || metricas.length === 0 || !horario_envio) {
        toast('Preencha todos os campos e selecione pelo menos uma métrica.', 'error');
        return;
    }

    const payload = {
        instance_name,
        target_jid,
        is_group: isGroup,
        nome_destino,
        metricas,
        frequencia,
        horario_envio
    };

    try {
        const token = localStorage.getItem('adlytics_token');
        const res = await fetch('/api/reports-config', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(payload)
        });

        if(!res.ok) throw new Error('Falha ao salvar relatorio');
        
        toast('Relatório agendado com sucesso!', 'success');
        fecharModalNovoRelatorio();
        carregarListaRelatorios();
    } catch(e) {
        console.error(e);
        toast('Erro ao agendar relatório.', 'error');
    }
}

async function deletarRelatorio(id) {
    if(!confirm('Deseja excluir este agendamento?')) return;
    try {
        const token = localStorage.getItem('adlytics_token');
        const res = await fetch(`/api/reports-config?id=${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if(!res.ok) throw new Error('Falha ao deletar');
        toast('Relatório excluído.', 'success');
        carregarListaRelatorios();
    } catch(e) {
        console.error(e);
        toast('Erro ao excluir.', 'error');
    }
}
