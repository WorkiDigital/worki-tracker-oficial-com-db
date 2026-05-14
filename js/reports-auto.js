// Lógica Frontend para Relatórios Automatizados (WhatsApp)

function abrirModalNovoRelatorio() {
    $('modalNovoRelatorio').classList.add('open');
    carregarInstanciasRelatorio();
}

function fecharModalNovoRelatorio() {
    $('modalNovoRelatorio').classList.remove('open');
}

function toggleRelatorioDestino() {
    const isGrupo = document.querySelector('input[name="relatorioTipoDestino"]:checked').value === 'grupo';
    $('relatorioContainerGrupo').style.display = isGrupo ? 'block' : 'none';
    $('relatorioContainerContato').style.display = isGrupo ? 'none' : 'block';
}

async function carregarInstanciasRelatorio() {
    try {
        const res = await fetch('/api/evo-manager?action=list', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!res.ok) throw new Error('Falha ao carregar instâncias');
        const instances = await res.json();
        
        const sel = $('relatorioInstance');
        sel.innerHTML = '<option value="">Selecione uma instância...</option>';
        
        instances.forEach(i => {
            if(i.state === 'open') {
                const opt = document.createElement('option');
                opt.value = i.fullName;
                opt.textContent = i.displayName;
                sel.appendChild(opt);
            }
        });
    } catch(e) {
        console.error(e);
        toast('Erro ao carregar instâncias para relatório.', 'error');
    }
}

async function carregarGruposRelatorio() {
    const instanceName = $('relatorioInstance').value;
    const selGroup = $('relatorioTargetGroup');
    
    if(!instanceName) {
        selGroup.innerHTML = '<option value="">Selecione uma instância primeiro...</option>';
        return;
    }

    selGroup.innerHTML = '<option value="">Carregando grupos...</option>';
    
    try {
        const res = await fetch(`/api/evo-groups?instanceName=${instanceName}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!res.ok) throw new Error('Falha ao buscar grupos');
        const groups = await res.json();
        
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
    try {
        const res = await fetch('/api/reports-config', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if(!res.ok) return;
        const relatorios = await res.json();
        
        const tbody = $('lista-relatorios-zap');
        tbody.innerHTML = '';
        
        if(relatorios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);">Nenhum relatório agendado.</td></tr>';
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
    const instance_name = $('relatorioInstance').value;
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
        const res = await fetch('/api/reports-config', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}` 
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
        const res = await fetch(`/api/reports-config?id=${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if(!res.ok) throw new Error('Falha ao deletar');
        toast('Relatório excluído.', 'success');
        carregarListaRelatorios();
    } catch(e) {
        console.error(e);
        toast('Erro ao excluir.', 'error');
    }
}

// Interceptar mudanças de abas para carregar lista
const originalMudarAbaRelZap = window.mudarAba;
window.mudarAba = function(aba) {
    if(originalMudarAbaRelZap) originalMudarAbaRelZap(aba);
    if(aba === 'relatorios-zap') {
        carregarListaRelatorios();
    }
};
