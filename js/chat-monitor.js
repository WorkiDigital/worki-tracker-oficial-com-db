const chatState = {
    initialized: false,
    conversations: [],
    selected: null,
    pollTimer: null,
    searchTimer: null,
    loadingList: false,
    // Composer
    currentThreadMessages: [],
    optimisticMessages: [],
    // Bolhas otimistas de conversas que NAO estao abertas no momento (ex: usuario
    // trocou de conversa antes do envio anterior resolver). Chave = chatConversationKey.
    optimisticByConversation: new Map(),
    pendingAttachment: null,
    mediaRecorder: null,
    recordedChunks: [],
    recordingStartedAt: null,
    recordingTimerInterval: null,
    recordingStream: null,
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
    // Quando a aba é aberta por um atalho de lead, chatAbrirConversaPorTelefone
    // assume o controle da carga (com o filtro de cliente certo). Evita a carga
    // dupla/flash que aconteceria se o init padrão do mudarAba rodasse junto.
    if (chatState.openingByPhone) return;
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
    chatBindComposerEvents();
}

function chatBindComposerEvents() {
    const input = $('chatComposerInput');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatSendComposerMessage();
        }
    });
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        chatUpdateSendButtonState();
    });
    document.addEventListener('click', (e) => {
        const picker = $('chatEmojiPicker');
        const btn = $('chatEmojiBtn');
        if (picker && picker.style.display !== 'none' && !picker.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
            picker.style.display = 'none';
        }
    });
}

async function chatLoadClientFilter() {
    const user = chatCurrentUser();
    const select = $('chatClienteFilter');
    if (!select) return;
    if (!user.is_admin) {
        select.style.display = 'none';
        select.disabled = true;
        return;
    }
    select.style.display = '';
    select.disabled = false;
    const previous = select.value;
    select.innerHTML = '<option value="">Carregando clientes...</option>';
    try {
        const res = await authFetch('/api/chat-messages?action=list_clients');
        const clients = await readApiJson(res, 'Falha ao carregar clientes com conversas');
        if (!Array.isArray(clients) || !clients.length) {
            select.innerHTML = '<option value="">Sem clientes com conversas</option>';
            select.disabled = true;
            return;
        }
        select.innerHTML = clients.map(c => `<option value="${esc(c.id)}">${esc(c.nome || c.id)}</option>`).join('');
        const stillExists = clients.some(c => String(c.id) === String(previous));
        select.value = stillExists ? previous : String(clients[0].id);
    } catch (e) {
        select.innerHTML = '<option value="">Clientes indisponiveis</option>';
        select.disabled = true;
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
    await chatLoadClientFilter();
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
        } else if (silent && stillExists) {
            // Poll silencioso (10s) com conversa ja aberta: recarrega so as mensagens,
            // sem re-selecionar o card na lista (evita "piscar" a lista lateral).
            await chatLoadMessages(chatState.selected, true);
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

// Assinatura leve para detectar se a lista de mensagens de uma thread mudou entre
// dois polls, sem precisar comparar objeto a objeto (usa quantidade + id/status da
// ultima mensagem, suficiente porque mensagens antigas nunca mudam de conteudo).
function chatThreadSignature(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) return '0';
    const last = list[list.length - 1];
    return `${list.length}|${last.id}|${last.message_at}`;
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

// Atalho vindo da aba Leads: abre a conversa de um telefone/instância específicos.
// Orquestra init + filtros + carga da lista + seleção, com fallback se não houver
// conversa recente (retenção de 15 dias). É chamada logo após mudarAba('conversas'),
// que já dispara chatMonitorInit() em paralelo — por isso aqui aguardamos o init
// completo (idempotente) e recarregamos a lista com o filtro certo, evitando corrida.
async function chatAbrirConversaPorTelefone(telefone, instance, clienteId) {
    const tel = String(telefone || '').replace(/\D/g, '');
    if (!tel) { toast('Lead sem telefone válido.', 'error'); return; }

    chatState.openingByPhone = true;
    try {
        // Garante bind/filtros carregados uma vez (mesma guarda de chatMonitorInit).
        if (!chatState.initialized) {
            chatState.initialized = true;
            chatBindEvents();
            await chatLoadClientFilter();
            await chatLoadInstances();
        }

        // Admin: aponta o filtro de cliente para o cliente do lead (não-admin já é
        // travado no próprio cliente pelo backend). Zera o filtro de instância para
        // "Todas" — a conversa pode estar em qualquer instância daquele cliente.
        const user = chatCurrentUser();
        if (user.is_admin && clienteId != null) {
            const cf = $('chatClienteFilter');
            if (cf) cf.value = String(clienteId);
        }
        const inst = $('chatInstanceFilter');
        if (inst) inst.value = '';

        chatState.selected = null;
        await chatLoadConversations(false);
        chatStartPolling();

        // Localiza a conversa exata (cliente|instance|telefone). Se a instância não
        // bater (ex: lead antigo com instância diferente da conversa atual), tenta
        // por cliente+telefone ignorando a instância.
        const wantKey = `${clienteId}|${instance}|${tel}`;
        let idx = chatState.conversations.findIndex(c => chatConversationKey(c) === wantKey);
        if (idx === -1) {
            idx = chatState.conversations.findIndex(c =>
                String(c.telefone).replace(/\D/g, '') === tel &&
                (clienteId == null || String(c.cliente_id) === String(clienteId))
            );
        }

        if (idx === -1) {
            toast('Sem conversa recente para este lead (retenção de 15 dias).', 'warning');
            return;
        }
        await chatSelectConversation(idx);
    } finally {
        chatState.openingByPhone = false;
    }
}

async function chatSelectConversation(index) {
    const conversation = chatState.conversations[index];
    if (!conversation) return;

    // Preserva bolhas otimistas ainda em voo/com erro da conversa que esta
    // fechando, para nao vazarem para a tela da nova conversa nem se perderem.
    if (chatState.selected && chatState.optimisticMessages.length) {
        const previousKey = chatConversationKey(chatState.selected);
        chatState.optimisticByConversation.set(previousKey, [...chatState.optimisticMessages]);
    }

    chatState.selected = conversation;
    chatRenderConversations();
    chatMobileShowThread();
    await Promise.all([
        chatLoadMessages(conversation),
        chatLoadLead(conversation)
    ]);
}

// ── Navegacao mobile (lista / conversa / lead como telas separadas) ──
function chatMobileShowList() {
    $('chatMonitorShell')?.classList.remove('mobile-show-thread', 'mobile-show-lead');
}
function chatMobileShowThread() {
    $('chatMonitorShell')?.classList.remove('mobile-show-lead');
    $('chatMonitorShell')?.classList.add('mobile-show-thread');
}
function chatMobileShowLead() {
    $('chatMonitorShell')?.classList.add('mobile-show-thread', 'mobile-show-lead');
}

async function chatLoadMessages(conversation, silent = false) {
    const box = $('chatMessagesList');
    const title = $('chatThreadTitle');
    const meta = $('chatThreadMeta');
    if (!box) return;
    if (title) title.textContent = conversation.lead_nome || conversation.push_name || conversation.telefone;
    if (meta) meta.textContent = `${conversation.telefone} - ${conversation.instance}`;
    if (!silent) {
        box.innerHTML = '<div class="chat-empty"><i data-lucide="loader-2" class="spinner"></i><span>Carregando...</span></div>';
        lucide.createIcons({ nodes: [box] });
        chatAutoloadedIds.clear(); // troca de conversa: o DOM foi zerado, midia precisa recarregar
    }
    try {
        const params = new URLSearchParams({
            action: 'get_messages',
            telefone: conversation.telefone,
            instance: conversation.instance,
            cliente_id: conversation.cliente_id
        });
        const res = await authFetch(`/api/chat-messages?${params.toString()}`);
        const messages = await readApiJson(res, 'Falha ao carregar mensagens');
        const nextMessages = Array.isArray(messages) ? messages : [];

        if (silent) {
            // Poll silencioso: se as mensagens nao mudaram desde o ultimo render,
            // NAO re-renderiza. Reescrever o DOM do zero a cada 10s reseta o scroll
            // do usuario (parece "travar" ao rolar) e recria os elementos de midia
            // ja carregados, disparando get_media de novo em massa (429).
            if (chatThreadSignature(nextMessages) === chatThreadSignature(chatState.currentThreadMessages)) {
                return;
            }
        } else {
            // Troca de conversa: restaura bolhas otimistas guardadas para esta
            // conversa especifica (chatResendOptimistic so guarda ali quando o envio
            // falhou enquanto o usuario estava em outra tela — sucesso remove a
            // bolha e a mensagem real ja vem no `messages` buscado acima).
            const conversationKey = chatConversationKey(conversation);
            const saved = chatState.optimisticByConversation.get(conversationKey) || [];
            chatState.optimisticByConversation.delete(conversationKey);
            chatState.optimisticMessages = saved;
        }
        chatState.currentThreadMessages = nextMessages;
        chatRenderMessages(chatMergeMessagesForRender());
    } catch (e) {
        if (silent) return;
        box.innerHTML = `<div class="chat-empty"><i data-lucide="alert-triangle"></i><span>${esc(e.message)}</span></div>`;
        lucide.createIcons({ nodes: [box] });
    }
}

const CHAT_AUTOLOAD_TYPES = new Set(['audio', 'image', 'sticker', 'video']);
const CHAT_AUTOLOAD_CONCURRENCY = 2;
let chatAutoloadToken = 0;
// Rastreia mensagens ja buscadas (ou em busca) via get_media, para o poll de 10s
// nao re-disparar a mesma midia a cada recarga silenciosa da thread.
const chatAutoloadedIds = new Set();

async function chatAutoloadMediaQueue(messages, token) {
    const queue = messages.filter(m =>
        CHAT_AUTOLOAD_TYPES.has(m.message_type) &&
        chatSafeUrl(m.media_url) &&
        !m.from_me && // midia ENVIADA pelo painel: a Evolution getBase64FromMediaMessage
                      // e pensada pra midia RECEBIDA, e sistematicamente falha pra mensagens
                      // proprias — tentar de novo a cada poll so gera rajada de 429 sem nunca
                      // conseguir carregar. O preview otimista ja mostrou a midia no envio.
        !chatAutoloadedIds.has(m.id)
    );
    let cursor = 0;
    async function worker() {
        while (cursor < queue.length) {
            if (token !== chatAutoloadToken) return; // conversa trocou, aborta fila
            const m = queue[cursor++];
            // Marca ANTES da tentativa (sucesso ou falha): nunca reintentar a mesma
            // mensagem automaticamente — evita loop infinito de get_media a cada poll.
            // O usuario ainda pode reabrir a conversa (chatAutoloadedIds.clear()) ou,
            // pra documento, clicar manualmente pra tentar de novo.
            chatAutoloadedIds.add(m.id);
            await chatLoadMedia(m.id, null, m.message_type);
        }
    }
    const workers = Array.from({ length: Math.min(CHAT_AUTOLOAD_CONCURRENCY, queue.length) }, worker);
    await Promise.all(workers);
}

function chatMergeMessagesForRender() {
    return [...(chatState.currentThreadMessages || []), ...chatState.optimisticMessages];
}

function chatRenderMessages(messages) {
    const box = $('chatMessagesList');
    if (!box) return;
    if (!Array.isArray(messages) || !messages.length) {
        box.innerHTML = '<div class="chat-empty"><i data-lucide="message-circle"></i><span>Sem mensagens nos ultimos 15 dias</span></div>';
        lucide.createIcons({ nodes: [box] });
        return;
    }
    // So gruda o scroll no fim se o usuario ja estava perto do fim (ou e o
    // primeiro render). Se ele rolou pra cima pra ler historico, um poll novo
    // nao deve arrancar a tela dele de volta pro final.
    const wasNearBottom = box.scrollHeight === 0 ||
        (box.scrollHeight - box.scrollTop - box.clientHeight) < 80;

    box.innerHTML = messages.map(m => `
        <div class="chat-message-row ${m.from_me ? 'from-me' : 'from-them'}">
            <div class="chat-bubble ${m.from_me ? 'from-me' : 'from-them'} ${m.__tempId ? 'optimistic' : ''}">
                ${m.__tempId ? chatRenderOptimisticMedia(m) : chatRenderMedia(m)}
                ${m.body ? `<div class="chat-bubble-text">${esc(m.body)}</div>` : ''}
                <div class="chat-bubble-time">
                    ${esc(chatFormatTime(m.message_at))}
                    ${m.from_me ? chatRenderStatusIcon(m) : ''}
                </div>
            </div>
        </div>
    `).join('');
    if (wasNearBottom) box.scrollTop = box.scrollHeight;
    lucide.createIcons({ nodes: [box] });

    const token = ++chatAutoloadToken;
    chatAutoloadMediaQueue(messages.filter(m => !m.__tempId), token);
}

function chatRenderStatusIcon(m) {
    if (!m.__tempId) return `<span class="chat-bubble-status sent"><i data-lucide="check-check"></i></span>`;
    if (m.__status === 'failed') {
        return `<span class="chat-bubble-status failed" onclick="chatRetryOptimisticMessage('${m.__tempId}')" title="${esc(m.__errorMessage || 'Falha ao enviar. Clique para tentar novamente.')}">
            <i data-lucide="alert-circle"></i>
        </span>`;
    }
    return `<span class="chat-bubble-status pending"><i data-lucide="clock"></i></span>`;
}

function chatRenderOptimisticMedia(m) {
    if (!m.__previewDataUrl) return '';
    if (m.message_type === 'image') return `<img class="chat-media-image" src="${esc(m.__previewDataUrl)}" alt="">`;
    if (m.message_type === 'video') return `<video class="chat-media-video" src="${esc(m.__previewDataUrl)}" controls></video>`;
    if (m.message_type === 'audio') return `<audio class="chat-media-audio" src="${esc(m.__previewDataUrl)}" controls></audio>`;
    return `<div class="chat-media-chip"><i data-lucide="paperclip"></i>${esc(m.__previewFileName || 'Arquivo')}</div>`;
}

function chatRenderMedia(message) {
    const url = chatSafeUrl(message.media_url);
    if (!url) return message.body ? '' : `<div class="chat-media-chip">${esc(chatMediaLabel(message.message_type))}</div>`;

    // Midia ENVIADA pelo painel: nao auto-carrega (ver chatAutoloadMediaQueue) porque
    // a Evolution sistematicamente nao consegue servir de volta midia propria via
    // get_media. Mostra botao manual em vez do spinner que nunca resolveria sozinho.
    if (message.from_me) {
        const icon = message.message_type === 'audio' ? 'volume-2'
            : message.message_type === 'video' ? 'video'
            : message.message_type === 'image' || message.message_type === 'sticker' ? 'image'
            : 'paperclip';
        const label = message.message_type === 'audio' ? 'Ouvir audio'
            : message.message_type === 'video' ? 'Ver video'
            : message.message_type === 'image' || message.message_type === 'sticker' ? 'Ver imagem'
            : 'Ver documento';
        const wrapId = message.message_type === 'audio' ? `chat-audio-${message.id}` : `chat-media-${message.id}`;
        return `<div class="chat-media-doc-wrap" id="${wrapId}">
            <button type="button" class="chat-media-load-btn" onclick="chatLoadMedia(${message.id}, this)">
                <i data-lucide="${icon}"></i><span>${label}</span>
            </button>
        </div>`;
    }

    if (message.message_type === 'audio') {
        return `<div class="chat-media-audio-wrap" id="chat-audio-${message.id}">
            <span class="chat-media-loading"><i data-lucide="loader-2" class="spinner"></i><span>Carregando audio...</span></span>
        </div>`;
    }
    if (message.message_type === 'image' || message.message_type === 'sticker') {
        return `<div class="chat-media-image-wrap" id="chat-media-${message.id}">
            <span class="chat-media-loading"><i data-lucide="loader-2" class="spinner"></i><span>Carregando imagem...</span></span>
        </div>`;
    }
    if (message.message_type === 'video') {
        return `<div class="chat-media-video-wrap" id="chat-media-${message.id}">
            <span class="chat-media-loading"><i data-lucide="loader-2" class="spinner"></i><span>Carregando video...</span></span>
        </div>`;
    }
    return `<div class="chat-media-doc-wrap" id="chat-media-${message.id}">
        <button type="button" class="chat-media-load-btn" onclick="chatLoadMedia(${message.id}, this)">
            <i data-lucide="paperclip"></i><span>Ver documento</span>
        </button>
    </div>`;
}

async function chatLoadMedia(messageId, btn, messageType) {
    const wrap = btn
        ? btn.closest('[id^="chat-audio-"], [id^="chat-media-"]')
        : ($(`chat-audio-${messageId}`) || $(`chat-media-${messageId}`));
    if (!wrap) return;
    const isAudio = wrap.id.startsWith('chat-audio-');
    let originalHtml = null;
    if (btn) {
        btn.disabled = true;
        originalHtml = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="loader-2" class="spinner"></i><span>Carregando...</span>';
        lucide.createIcons({ nodes: [wrap] });
    }
    try {
        const params = new URLSearchParams({ action: 'get_media', id: messageId });
        const cliente = $('chatClienteFilter')?.value || '';
        if (cliente) params.set('cliente_id', cliente);
        const res = await authFetch(`/api/chat-messages?${params.toString()}`);
        const data = await readApiJson(res, 'Falha ao carregar midia');
        if (isAudio) {
            wrap.innerHTML = `<audio class="chat-media-audio" controls preload="auto" src="${esc(data.dataUrl)}"></audio>`;
        } else if (data.dataUrl.startsWith('data:image')) {
            wrap.innerHTML = `<a href="${esc(data.dataUrl)}" target="_blank" rel="noopener"><img class="chat-media-image" src="${esc(data.dataUrl)}" alt=""></a>`;
        } else if (data.dataUrl.startsWith('data:video')) {
            wrap.innerHTML = `<video class="chat-media-video" controls preload="metadata" src="${esc(data.dataUrl)}"></video>`;
        } else {
            wrap.innerHTML = `<a class="chat-media-link" href="${esc(data.dataUrl)}" target="_blank" rel="noopener"><i data-lucide="paperclip"></i>Baixar arquivo</a>`;
            lucide.createIcons({ nodes: [wrap] });
        }
        return true;
    } catch (e) {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            lucide.createIcons({ nodes: [wrap] });
        } else {
            wrap.innerHTML = `<span class="chat-media-error"><i data-lucide="alert-triangle"></i><span>Falha ao carregar</span></span>`;
            lucide.createIcons({ nodes: [wrap] });
        }
        if (btn) toast(e.message || 'Falha ao carregar midia', 'error');
        return false;
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

// ── Composer: emoji picker ───────────────────────────────────────
const CHAT_COMMON_EMOJIS = [
    '😀','😁','😂','🤣','😊','😍','😘','😉','😎','🤔',
    '😅','😢','😭','😡','👍','👎','👏','🙏','💪','🤝',
    '❤️','💙','💚','💛','🧡','💜','🔥','✨','🎉','🎊',
    '✅','❌','⚠️','❓','❗','💯','👋','🙌','🤞','🫡',
    '📌','📅','📞','💬','📸','🎥','🎵','📄','💰','💵',
    '🛒','📦','🚀','⏰','⭐','😴','🤗','😇','🙄','😬',
];

function chatToggleEmojiPicker() {
    const picker = $('chatEmojiPicker');
    if (!picker) return;
    if (picker.style.display === 'none') {
        picker.innerHTML = CHAT_COMMON_EMOJIS.map(em =>
            `<button type="button" onclick="chatInsertEmoji('${em}')">${em}</button>`
        ).join('');
        picker.style.display = 'grid';
    } else {
        picker.style.display = 'none';
    }
}

function chatInsertEmoji(emoji) {
    const input = $('chatComposerInput');
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    chatUpdateSendButtonState();
}

// ── Composer: selecao de anexo ───────────────────────────────────
const CHAT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function chatFileKind(file) {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'document';
}

function chatFileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function chatHandleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > CHAT_MAX_ATTACHMENT_BYTES) {
        toast('Arquivo excede o limite de 20MB.', 'error');
        return;
    }
    try {
        const dataUrl = await chatFileToDataUrl(file);
        const [, base64] = dataUrl.split(',', 2);
        chatState.pendingAttachment = {
            dataUrl, base64,
            mimeType: file.type || 'application/octet-stream',
            kind: chatFileKind(file),
            fileName: file.name,
            fileSize: file.size,
            audioMode: 'file',
        };
        chatRenderComposerPreview();
        chatUpdateSendButtonState();
    } catch (e) {
        toast('Falha ao ler o arquivo selecionado.', 'error');
    }
}

function chatFormatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function chatRenderComposerPreview() {
    const box = $('chatComposerPreview');
    const att = chatState.pendingAttachment;
    if (!box) return;
    if (!att) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'flex';
    let mediaHtml = '<i data-lucide="paperclip"></i>';
    if (att.kind === 'image') mediaHtml = `<img src="${esc(att.dataUrl)}" alt="">`;
    else if (att.kind === 'video') mediaHtml = `<video src="${esc(att.dataUrl)}" muted></video>`;
    box.innerHTML = `
        ${mediaHtml}
        <div class="chat-composer-preview-info">
            <strong>${esc(att.fileName || chatMediaLabel(att.kind))}</strong>
            <span>${chatFormatFileSize(att.fileSize)}</span>
        </div>
        <button type="button" class="chat-composer-preview-remove" onclick="chatClearAttachment()">
            <i data-lucide="x"></i>
        </button>`;
    lucide.createIcons({ nodes: [box] });
}

function chatClearAttachment() {
    chatState.pendingAttachment = null;
    chatRenderComposerPreview();
    chatUpdateSendButtonState();
}

// ── Composer: gravacao de audio ──────────────────────────────────
async function chatToggleAudioRecording() {
    if (chatState.mediaRecorder && chatState.mediaRecorder.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        toast('Gravacao de audio nao suportada neste navegador.', 'error');
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chatState.recordingStream = stream;
        const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
            ? 'audio/ogg;codecs=opus'
            : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '');
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        chatState.recordedChunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chatState.recordedChunks.push(e.data); };
        recorder.start();
        chatState.mediaRecorder = recorder;
        chatState.recordingStartedAt = Date.now();
        chatShowRecordingBar();
    } catch (e) {
        toast('Permissao de microfone negada ou indisponivel.', 'error');
    }
}

function chatShowRecordingBar() {
    $('chatMicBtn')?.classList.add('recording');
    const bar = $('chatRecordingBar');
    if (bar) bar.style.display = 'flex';
    const row = $('chatComposer')?.querySelector('.chat-composer-row');
    if (row) row.style.display = 'none';
    chatState.recordingTimerInterval = setInterval(() => {
        const secs = Math.floor((Date.now() - chatState.recordingStartedAt) / 1000);
        const m = Math.floor(secs / 60);
        const s = String(secs % 60).padStart(2, '0');
        const timer = $('chatRecordingTimer');
        if (timer) timer.textContent = `${m}:${s}`;
    }, 250);
}

function chatHideRecordingBar() {
    clearInterval(chatState.recordingTimerInterval);
    $('chatMicBtn')?.classList.remove('recording');
    const bar = $('chatRecordingBar');
    if (bar) bar.style.display = 'none';
    const row = $('chatComposer')?.querySelector('.chat-composer-row');
    if (row) row.style.display = '';
}

function chatStopRecordingStream() {
    chatState.recordingStream?.getTracks().forEach(t => t.stop());
    chatState.recordingStream = null;
}

function chatCancelAudioRecording() {
    if (chatState.mediaRecorder && chatState.mediaRecorder.state === 'recording') {
        chatState.mediaRecorder.onstop = null;
        chatState.mediaRecorder.stop();
    }
    chatStopRecordingStream();
    chatState.mediaRecorder = null;
    chatState.recordedChunks = [];
    chatHideRecordingBar();
}

function chatStopAudioRecording() {
    const recorder = chatState.mediaRecorder;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.onstop = async () => {
        chatStopRecordingStream();
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chatState.recordedChunks, { type: mimeType });
        chatState.mediaRecorder = null;
        chatState.recordedChunks = [];
        chatHideRecordingBar();
        try {
            const dataUrl = await chatFileToDataUrl(blob);
            const [, base64] = dataUrl.split(',', 2);
            chatState.pendingAttachment = {
                dataUrl, base64, mimeType,
                kind: 'audio', fileName: 'audio-mensagem.ogg',
                fileSize: blob.size, audioMode: 'ptt',
            };
            await chatSendComposerMessage();
        } catch (e) {
            toast('Falha ao processar o audio gravado.', 'error');
        }
    };
    recorder.stop();
}

// ── Composer: envio e reenvio ─────────────────────────────────────
async function chatHandleComposerSubmit(event) {
    event.preventDefault();
    await chatSendComposerMessage();
    return false;
}

function chatUpdateSendButtonState() {
    const btn = $('chatSendBtn');
    if (!btn) return;
    const hasText = ($('chatComposerInput')?.value || '').trim().length > 0;
    btn.disabled = !hasText && !chatState.pendingAttachment;
}

async function chatSendComposerMessage() {
    const conversation = chatState.selected;
    if (!conversation) { toast('Selecione uma conversa antes de enviar.', 'error'); return; }

    const input = $('chatComposerInput');
    const text = (input?.value || '').trim();
    const attachment = chatState.pendingAttachment;
    if (!text && !attachment) return;

    const messageType = attachment ? attachment.kind : 'text';
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conversationKey = chatConversationKey(conversation);

    const payload = {
        action: 'send_message',
        instance: conversation.instance,
        telefone: conversation.telefone,
        cliente_id: conversation.cliente_id,
        message_type: messageType,
    };
    if (messageType === 'text') {
        payload.text = text;
    } else {
        payload.media_base64 = attachment.base64;
        payload.mime_type = attachment.mimeType;
        payload.file_name = attachment.fileName;
        if (text) payload.caption = text;
        if (messageType === 'audio') payload.audio_mode = attachment.audioMode || 'file';
    }

    const optimistic = {
        __tempId: tempId,
        __status: 'pending',
        __payload: payload,
        __conversationKey: conversationKey,
        from_me: true,
        body: attachment ? (attachment.kind === 'image' || attachment.kind === 'video' ? text || null : null) : text,
        message_type: messageType,
        message_at: new Date().toISOString(),
        __previewDataUrl: attachment ? attachment.dataUrl : null,
        __previewFileName: attachment ? attachment.fileName : null,
    };
    chatState.optimisticMessages.push(optimistic);
    chatRenderMessages(chatMergeMessagesForRender());

    if (input) { input.value = ''; input.style.height = 'auto'; }
    chatClearAttachment();
    chatUpdateSendButtonState();

    await chatResendOptimistic(optimistic);
}

// Retorna true se `key` corresponde a conversa atualmente aberta (chatState.selected).
function chatIsActiveConversation(key) {
    return !!(chatState.selected && chatConversationKey(chatState.selected) === key);
}

// Remove uma bolha otimista de onde quer que ela esteja (thread ativa ou de outra
// conversa) e devolve o array/Map de onde ela veio, para o chamador decidir o que fazer.
function chatRemoveOptimisticEverywhere(tempId) {
    chatState.optimisticMessages = chatState.optimisticMessages.filter(m => m.__tempId !== tempId);
    for (const [key, list] of chatState.optimisticByConversation) {
        const filtered = list.filter(m => m.__tempId !== tempId);
        if (filtered.length) chatState.optimisticByConversation.set(key, filtered);
        else chatState.optimisticByConversation.delete(key);
    }
}

async function chatResendOptimistic(msg) {
    msg.__status = 'pending';
    msg.__errorMessage = null;
    if (chatIsActiveConversation(msg.__conversationKey)) {
        chatRenderMessages(chatMergeMessagesForRender());
    }
    try {
        const res = await authFetch('/api/chat-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.__payload)
        });
        const data = await readApiJson(res, 'Falha ao enviar mensagem');
        chatRemoveOptimisticEverywhere(msg.__tempId);
        // So injeta a mensagem confirmada na thread em memoria se ainda for a
        // conversa aberta — senao ela sera buscada normalmente quando o usuario
        // reabrir aquela conversa (chatLoadMessages busca do servidor de novo).
        if (chatIsActiveConversation(msg.__conversationKey) && data.message &&
            !(chatState.currentThreadMessages || []).some(m => m.id === data.message.id)) {
            chatState.currentThreadMessages = [...(chatState.currentThreadMessages || []), data.message];
        }
    } catch (e) {
        msg.__status = 'failed';
        msg.__errorMessage = e.message;
        // Só incomoda o usuário com o toast se ele ainda estiver olhando essa conversa.
        if (chatIsActiveConversation(msg.__conversationKey)) {
            toast(e.message || 'Falha ao enviar mensagem', 'error');
        } else {
            // Conversa nao esta mais aberta: guarda a bolha (com erro) para
            // reaparecer quando o usuario reabrir aquela conversa.
            const existing = chatState.optimisticByConversation.get(msg.__conversationKey) || [];
            if (!existing.some(m => m.__tempId === msg.__tempId)) {
                chatState.optimisticByConversation.set(msg.__conversationKey, [...existing, msg]);
            }
        }
    }
    if (chatIsActiveConversation(msg.__conversationKey)) {
        chatRenderMessages(chatMergeMessagesForRender());
    }
}

async function chatRetryOptimisticMessage(tempId) {
    const msg = chatState.optimisticMessages.find(m => m.__tempId === tempId);
    if (msg) await chatResendOptimistic(msg);
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
window.chatAbrirConversaPorTelefone = chatAbrirConversaPorTelefone;
window.chatLoadMedia = chatLoadMedia;
window.chatMobileShowList = chatMobileShowList;
window.chatMobileShowThread = chatMobileShowThread;
window.chatMobileShowLead = chatMobileShowLead;
window.chatHandleComposerSubmit = chatHandleComposerSubmit;
window.chatToggleEmojiPicker = chatToggleEmojiPicker;
window.chatInsertEmoji = chatInsertEmoji;
window.chatHandleFileSelected = chatHandleFileSelected;
window.chatClearAttachment = chatClearAttachment;
window.chatToggleAudioRecording = chatToggleAudioRecording;
window.chatStopAudioRecording = chatStopAudioRecording;
window.chatCancelAudioRecording = chatCancelAudioRecording;
window.chatRetryOptimisticMessage = chatRetryOptimisticMessage;
