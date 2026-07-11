const chatState = {
    initialized: false,
    conversations: [],
    selected: null,
    pollTimer: null,
    searchTimer: null,
    loadingList: false,
};

function chatCurrentUser() {
    try { return JSON.parse(localStorage.getItem('adlytics_user') || '{}'); }
    catch (_) { return {}; }
}

function chatBuildParams(extra = {}) {
    const params = new URLSearchParams(extra);
    const cliente = $('chatClienteFilter')?.value || '';
    const instance = $('chatInstanceFilter')?.value || '';
    const search = $('chatSearchInput')?.value?.trim() || '';
    if (cliente) params.set('cliente_id', cliente);
    if (instance) params.set('instance', instance);
    if (search) params.set('search', search);
    return params;
}

async function chatMonitorInit() {
    if (!chatState.initialized) {
        chatState.initialized = true;
        chatBindEvents();
        await chatLoadClientFilter();
        await chatLoadInstances();
    }
    await chatLoadConversations(false);
    chatStartPolling();
}

function chatBindEvents() {
    $('chatSearchInput')?.addEventListener('input', () => {
        clearTimeout(chatState.searchTimer);
        chatState.searchTimer = setTimeout(() => chatLoadConversations(false), 300);
    });
    $('chatInstanceFilter')?.addEventListener('change', () => {
        chatState.selected = null;
        chatLoadConversations(false);
    });
    $('chatClienteFilter')?.addEventListener('change', async () => {
        chatState.selected = null;
        await chatLoadInstances();
        await chatLoadConversations(false);
    });
}

async function chatLoadClientFilter() {
    const user = chatCurrentUser();
    const select = $('chatClienteFilter');
    if (!select) return;
    if (!user.is_admin) {
        select.style.display = 'none';
        return;
    }
    select.style.display = '';
    select.innerHTML = '<option value="">Todos os clientes</option>';
    try {
        const res = await authFetch('/api/clientes');
        const clients = await readApiJson(res, 'Falha ao carregar clientes');
        select.innerHTML += clients.map(c => `<option value="${esc(c.id)}">${esc(c.nome || c.email_contato || c.id)}</option>`).join('');
    } catch (e) {
        select.innerHTML = '<option value="">Clientes indisponiveis</option>';
    }
}

async function chatLoadInstances() {
    const select = $('chatInstanceFilter');
    if (!select) return;
    select.innerHTML = '<option value="">Todas as instancias</option>';
    try {
        const params = new URLSearchParams({ action: 'list' });
        const cliente = $('chatClienteFilter')?.value || '';
        if (cliente) params.set('target_cliente_id', cliente);
        const res = await authFetch(`/api/evo-manager?${params.toString()}`);
        const instances = await readApiJson(res, 'Falha ao carregar instancias');
        const options = (Array.isArray(instances) ? instances : [])
            .filter(i => i.fullName)
            .map(i => {
                const owner = i.cliente_nome ? ` - ${i.cliente_nome}` : '';
                const phone = i.whatsapp_number ? ` (${i.whatsapp_number})` : '';
                return `<option value="${esc(i.fullName)}">${esc(i.displayName || i.fullName)}${esc(phone)}${esc(owner)}</option>`;
            }).join('');
        select.innerHTML += options;
    } catch (e) {
        select.innerHTML = '<option value="">Instancias indisponiveis</option>';
    }
}

function chatStartPolling() {
    chatStopPolling();
    chatState.pollTimer = setInterval(() => {
        if (!$('aba-conversas')?.classList.contains('aba-oculta')) {
            chatLoadConversations(true);
        }
    }, 10000);
}

function chatStopPolling() {
    if (chatState.pollTimer) {
        clearInterval(chatState.pollTimer);
        chatState.pollTimer = null;
    }
}

async function chatMonitorRefresh() {
    await chatLoadInstances();
    await chatLoadConversations(false);
}

async function chatLoadConversations(silent = false) {
    if (chatState.loadingList) return;
    chatState.loadingList = true;
    const list = $('chatConversationsList');
    const count = $('chatConversationCount');
    if (list && !silent) {
        list.innerHTML = '<div class="chat-empty"><i data-lucide="loader-2" class="spinner"></i><span>Carregando...</span></div>';
        lucide.createIcons({ nodes: [list] });
    }
    try {
        const params = chatBuildParams({ action: 'list_conversations' });
        const res = await authFetch(`/api/chat-messages?${params.toString()}`);
        const rows = await readApiJson(res, 'Falha ao carregar conversas');
        chatState.conversations = Array.isArray(rows) ? rows : [];
        if (count) count.textContent = chatState.conversations.length;
        chatRenderConversations();

        const selectedKey = chatState.selected && chatConversationKey(chatState.selected);
        const stillExists = selectedKey && chatState.conversations.find(c => chatConversationKey(c) === selectedKey);
        if (!stillExists && chatState.conversations.length) {
            await chatSelectConversation(0);
        } else if (!chatState.conversations.length) {
            chatState.selected = null;
            chatRenderEmptyThread();
        }
    } catch (e) {
        if (!silent) {
            if (list) list.innerHTML = `<div class="chat-empty"><i data-lucide="alert-triangle"></i><span>${esc(e.message)}</span></div>`;
            toast(e.message, 'error');
        }
    } finally {
        chatState.loadingList = false;
    }
}

function chatConversationKey(c) {
    return `${c.cliente_id}|${c.instance}|${c.telefone}`;
}

function chatRenderConversations() {
    const list = $('chatConversationsList');
    if (!list) return;
    if (!chatState.conversations.length) {
        list.innerHTML = '<div class="chat-empty"><i data-lucide="inbox"></i><span>Nenhuma conversa encontrada</span></div>';
        lucide.createIcons({ nodes: [list] });
        return;
    }
    const selectedKey = chatState.selected && chatConversationKey(chatState.selected);
    list.innerHTML = chatState.conversations.map((c, idx) => {
        const active = selectedKey === chatConversationKey(c);
        const title = c.lead_nome || c.push_name || c.telefone;
        const preview = c.body || chatMediaLabel(c.message_type);
        const origemBadge = chatOrigemBadge(c.lead_origin);
        return `<button type="button" class="chat-conversation ${active ? 'active' : ''}" onclick="chatSelectConversation(${idx})">
            <span class="chat-avatar">${esc(chatInitials(title))}</span>
            <span class="chat-conversation-main">
                <span class="chat-conversation-top">
                    <strong title="${esc(title)}">${esc(title)}</strong>
                    <small>${esc(chatRelativeTime(c.message_at))}</small>
                </span>
                <span class="chat-conversation-preview">${c.from_me ? 'Voce: ' : ''}${esc(preview)}</span>
                <span class="chat-conversation-meta">
                    <span>${esc(c.telefone)} - ${esc(c.instance)}</span>
                    ${origemBadge}
                </span>
            </span>
        </button>`;
    }).join('');
    lucide.createIcons({ nodes: [list] });
}

async function chatSelectConversation(index) {
    const conversation = chatState.conversations[index];
    if (!conversation) return;
    chatState.selected = conversation;
    chatRenderConversations();
    await Promise.all([
        chatLoadMessages(conversation),
        chatLoadLead(conversation)
    ]);
}

async function chatLoadMessages(conversation) {
    const box = $('chatMessagesList');
    const title = $('chatThreadTitle');
    const meta = $('chatThreadMeta');
    if (!box) return;
    if (title) title.textContent = conversation.lead_nome || conversation.push_name || conversation.telefone;
    if (meta) meta.textContent = `${conversation.telefone} - ${conversation.instance}`;
    box.innerHTML = '<div class="chat-empty"><i data-lucide="loader-2" class="spinner"></i><span>Carregando...</span></div>';
    lucide.createIcons({ nodes: [box] });
    try {
        const params = new URLSearchParams({
            action: 'get_messages',
            telefone: conversation.telefone,
            instance: conversation.instance,
            cliente_id: conversation.cliente_id
        });
        const res = await authFetch(`/api/chat-messages?${params.toString()}`);
        const messages = await readApiJson(res, 'Falha ao carregar mensagens');
        chatRenderMessages(messages);
    } catch (e) {
        box.innerHTML = `<div class="chat-empty"><i data-lucide="alert-triangle"></i><span>${esc(e.message)}</span></div>`;
        lucide.createIcons({ nodes: [box] });
    }
}

function chatRenderMessages(messages) {
    const box = $('chatMessagesList');
    if (!box) return;
    if (!Array.isArray(messages) || !messages.length) {
        box.innerHTML = '<div class="chat-empty"><i data-lucide="message-circle"></i><span>Sem mensagens nos ultimos 15 dias</span></div>';
        lucide.createIcons({ nodes: [box] });
        return;
    }
    box.innerHTML = messages.map(m => `
        <div class="chat-message-row ${m.from_me ? 'from-me' : 'from-them'}">
            <div class="chat-bubble ${m.from_me ? 'from-me' : 'from-them'}">
                ${chatRenderMedia(m)}
                ${m.body ? `<div class="chat-bubble-text">${esc(m.body)}</div>` : ''}
                <div class="chat-bubble-time">${esc(chatFormatTime(m.message_at))}</div>
            </div>
        </div>
    `).join('');
    box.scrollTop = box.scrollHeight;
}

function chatRenderMedia(message) {
    const url = chatSafeUrl(message.media_url);
    if (!url) return message.body ? '' : `<div class="chat-media-chip">${esc(chatMediaLabel(message.message_type))}</div>`;
    if (message.message_type === 'audio') {
        return `<div class="chat-media-audio-wrap" id="chat-audio-${message.id}">
            <button type="button" class="chat-media-audio-play" onclick="chatLoadMedia(${message.id}, this)">
                <i data-lucide="play"></i><span>Ouvir audio</span>
            </button>
        </div>`;
    }
    if (message.message_type === 'image' || message.message_type === 'sticker') {
        return `<div class="chat-media-image-wrap" id="chat-media-${message.id}">
            <button type="button" class="chat-media-load-btn" onclick="chatLoadMedia(${message.id}, this)">
                <i data-lucide="image"></i><span>Ver imagem</span>
            </button>
        </div>`;
    }
    if (message.message_type === 'video') {
        return `<div class="chat-media-video-wrap" id="chat-media-${message.id}">
            <button type="button" class="chat-media-load-btn" onclick="chatLoadMedia(${message.id}, this)">
                <i data-lucide="video"></i><span>Ver video</span>
            </button>
        </div>`;
    }
    return `<div class="chat-media-chip">${esc(chatMediaLabel(message.message_type))}</div>`;
}

async function chatLoadMedia(messageId, btn) {
    const wrap = btn.closest('[id^="chat-audio-"], [id^="chat-media-"]');
    if (!wrap) return;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-2" class="spinner"></i><span>Carregando...</span>';
    lucide.createIcons({ nodes: [wrap] });
    try {
        const params = new URLSearchParams({ action: 'get_media', id: messageId });
        const cliente = $('chatClienteFilter')?.value || '';
        if (cliente) params.set('cliente_id', cliente);
        const res = await authFetch(`/api/chat-messages?${params.toString()}`);
        const data = await readApiJson(res, 'Falha ao carregar midia');
        const isAudio = wrap.id.startsWith('chat-audio-');
        if (isAudio) {
            wrap.innerHTML = `<audio class="chat-media-audio" controls autoplay src="${esc(data.dataUrl)}"></audio>`;
        } else if (data.dataUrl.startsWith('data:image')) {
            wrap.innerHTML = `<a href="${esc(data.dataUrl)}" target="_blank" rel="noopener"><img class="chat-media-image" src="${esc(data.dataUrl)}" alt=""></a>`;
        } else if (data.dataUrl.startsWith('data:video')) {
            wrap.innerHTML = `<video class="chat-media-video" controls src="${esc(data.dataUrl)}"></video>`;
        } else {
            wrap.innerHTML = `<a class="chat-media-link" href="${esc(data.dataUrl)}" target="_blank" rel="noopener"><i data-lucide="paperclip"></i>Baixar arquivo</a>`;
            lucide.createIcons({ nodes: [wrap] });
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        lucide.createIcons({ nodes: [wrap] });
        toast(e.message || 'Falha ao carregar midia', 'error');
    }
}

async function chatLoadLead(conversation) {
    const box = $('chatLeadCard');
    if (!box) return;
    box.innerHTML = '<div class="chat-empty compact"><i data-lucide="loader-2" class="spinner"></i><span>Carregando lead...</span></div>';
    lucide.createIcons({ nodes: [box] });
    try {
        const params = new URLSearchParams({
            action: 'get_lead',
            telefone: conversation.telefone,
            cliente_id: conversation.cliente_id
        });
        const res = await authFetch(`/api/chat-messages?${params.toString()}`);
        const data = await readApiJson(res, 'Falha ao carregar lead');
        chatRenderLead(data.lead, conversation);
    } catch (e) {
        box.innerHTML = `<div class="chat-empty compact"><i data-lucide="alert-triangle"></i><span>${esc(e.message)}</span></div>`;
        lucide.createIcons({ nodes: [box] });
    }
}

function chatRenderLead(lead, conversation) {
    const box = $('chatLeadCard');
    if (!box) return;
    if (!lead) {
        box.innerHTML = `
            <div class="chat-lead-empty">
                <i data-lucide="user-round"></i>
                <strong>${esc(conversation.push_name || conversation.telefone)}</strong>
                <span>${esc(conversation.telefone)}</span>
                <small>${esc(conversation.instance)}</small>
            </div>`;
        lucide.createIcons({ nodes: [box] });
        return;
    }
    box.innerHTML = `
        <div class="chat-lead-head">
            <span class="chat-avatar large">${esc(chatInitials(lead.nome || lead.telefone))}</span>
            <div>
                <strong>${esc(lead.nome || 'Sem nome')}</strong>
                <span>${esc(lead.telefone || '')}</span>
            </div>
        </div>
        <div class="chat-lead-rows">
            ${chatLeadRow('Status', lead.status)}
            ${chatLeadRow('Valor', chatFormatMoney(lead.valor_venda))}
            ${chatLeadRow('Origem', lead.lead_origin)}
            ${chatLeadRow('Campanha', lead.utm_campaign)}
            ${chatLeadRow('Conjunto', lead.utm_medium)}
            ${chatLeadRow('Anuncio', lead.utm_content)}
            ${chatLeadRow('Instancia', lead.instancia)}
            ${chatLeadRow('Entrada', chatFormatDate(lead.created_at || lead.event_time))}
        </div>
        <button class="btn btn-primary chat-lead-open" onclick="abrirPerfilLead(${Number(lead.id)})">
            <i data-lucide="user"></i> Abrir perfil
        </button>`;
    lucide.createIcons({ nodes: [box] });
}

function chatLeadRow(label, value) {
    if (!value) return '';
    return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function chatFormatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function chatRenderEmptyThread() {
    const box = $('chatMessagesList');
    const title = $('chatThreadTitle');
    const meta = $('chatThreadMeta');
    const lead = $('chatLeadCard');
    if (title) title.textContent = 'Conversa';
    if (meta) meta.textContent = 'Retencao de 15 dias';
    if (box) box.innerHTML = '<div class="chat-empty"><i data-lucide="messages-square"></i><span>Selecione uma conversa</span></div>';
    if (lead) lead.innerHTML = '<div class="chat-empty compact"><i data-lucide="user-round"></i><span>Nenhum lead selecionado</span></div>';
    lucide.createIcons();
}

function chatOrigemBadge(origem) {
    if (!origem || typeof obterOrigemLead !== 'function') return '';
    const info = obterOrigemLead(origem);
    return `<span class="chat-origem-badge" style="background:${info.bg};color:${info.color};border-color:${info.border};">${esc(info.label)}</span>`;
}

function chatInitials(value) {
    const parts = String(value || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function chatMediaLabel(type) {
    const labels = { image: 'Imagem', audio: 'Audio', video: 'Video', document: 'Documento', sticker: 'Figurinha' };
    return labels[type] || 'Mensagem';
}

function chatSafeUrl(url) {
    if (!url) return null;
    const trimmed = String(url).trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function chatFormatTime(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function chatFormatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function chatRelativeTime(value) {
    if (!value) return '';
    const diff = Date.now() - new Date(value).getTime();
    const min = Math.max(0, Math.floor(diff / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} h`;
    return `${Math.floor(hours / 24)} d`;
}

window.chatMonitorInit = chatMonitorInit;
window.chatMonitorRefresh = chatMonitorRefresh;
window.chatStopPolling = chatStopPolling;
window.chatSelectConversation = chatSelectConversation;
window.chatLoadMedia = chatLoadMedia;
