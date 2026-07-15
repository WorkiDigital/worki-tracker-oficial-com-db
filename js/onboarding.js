// ── Wizard de Onboarding ─────────────────────────────────────────
// Orquestra telas/funções JÁ EXISTENTES no painel (cadastro de cliente,
// conexão WhatsApp, criação de link, conversões) num fluxo guiado de 7
// etapas. Não recria nenhuma lógica de negócio — só reaproveita por id/nome.

const ONB_ETAPAS = ['boasvindas', 'cliente', 'whatsapp', 'rastreamento', 'kanban', 'conversao', 'final'];

// Fonte única dos 5 marcos de progresso — usada na etapa final e no badge
// persistente, evitando divergência de texto entre os dois lugares.
const ONB_MARCOS = [
    ['cliente_criado', 'Cliente cadastrado'],
    ['whatsapp_conectado', 'WhatsApp conectado'],
    ['tracking_criado', 'Rastreamento criado'],
    ['lead_recebido', 'Primeiro lead recebido'],
    ['conversao_configurada', 'Conversão configurada'],
];

const ONB_TEXTOS = {
    agencia: {
        cliente_titulo: 'Cadastre sua primeira conta gerenciada',
        cliente_sub: 'Crie o acesso do primeiro cliente que você vai gerenciar na agência.',
    },
    empresa: {
        cliente_titulo: 'Cadastre sua primeira empresa',
        cliente_sub: 'Crie o acesso para começar a rastrear os leads da sua empresa.',
    },
    gestor_trafego: {
        cliente_titulo: 'Cadastre seu primeiro cliente',
        cliente_sub: 'Crie o acesso do cliente cujos anúncios você vai gerenciar.',
    },
};

const onbState = {
    etapaIdx: 0,
    perfil: null,
    clienteId: null,
    ultimoSlugCriado: null,
    _skipSessionKey: 'onb_pulado_sessao',
};

function onbTextos() {
    return ONB_TEXTOS[onbState.perfil] || ONB_TEXTOS.gestor_trafego;
}

function onbUsuarioEhAdmin(user = null) {
    const u = user || JSON.parse(localStorage.getItem('adlytics_user') || '{}');
    return u?.is_admin === true || u?.is_admin === 'true' || u?.is_admin === 1 || u?.is_admin === '1';
}

function onbNormalizarEtapaUsuario(direcao = 1, user = null) {
    if (onbUsuarioEhAdmin(user)) return;
    if (ONB_ETAPAS[onbState.etapaIdx] !== 'cliente') return;
    const proxima = onbState.etapaIdx + (direcao >= 0 ? 1 : -1);
    onbState.etapaIdx = Math.min(Math.max(proxima, 0), ONB_ETAPAS.length - 1);
}

// ── Abertura / fechamento ────────────────────────────────────────
async function abrirWizardOnboarding(user) {
    if (sessionStorage.getItem(onbState._skipSessionKey) === '1') return;

    onbState.perfil = user?.onboarding_perfil || null;
    const usuarioAdmin = onbUsuarioEhAdmin(user);

    // Decide onde retomar consultando o progresso real (nunca reinicia do
    // zero se o usuário já cumpriu marcos antes de fechar o wizard).
    let status = null;
    try {
        const r = await authFetch('/api/onboarding-status');
        if (r.ok) status = await r.json();
    } catch (e) { /* segue sem status — abre da etapa 1 */ }

    if (status) {
        if (usuarioAdmin && !status.cliente_criado) onbState.etapaIdx = ONB_ETAPAS.indexOf('cliente');
        else if (!status.whatsapp_conectado) onbState.etapaIdx = ONB_ETAPAS.indexOf('whatsapp');
        else if (!status.tracking_criado) onbState.etapaIdx = ONB_ETAPAS.indexOf('rastreamento');
        else if (!status.conversao_configurada) onbState.etapaIdx = ONB_ETAPAS.indexOf('conversao');
        else onbState.etapaIdx = ONB_ETAPAS.indexOf('final');
        // Perfil ainda não escolhido: sempre começa pela etapa 1.
        if (!onbState.perfil) onbState.etapaIdx = 0;
    } else {
        onbState.etapaIdx = 0;
    }

    $('onboardingWizard').classList.add('open');
    onbRenderStep();
    onbAtualizarChecklistBadge();
}

function onbFechar() {
    $('onboardingWizard').classList.remove('open');
    try { sessionStorage.setItem(onbState._skipSessionKey, '1'); } catch (e) {}
    onbAtualizarChecklistBadge();
}

// ── Navegação ────────────────────────────────────────────────────
function onbAvancar() {
    if (onbState.etapaIdx < ONB_ETAPAS.length - 1) {
        onbState.etapaIdx++;
        onbNormalizarEtapaUsuario(1);
        onbRenderStep();
    }
}

function onbVoltar() {
    if (onbState.etapaIdx > 0) {
        onbState.etapaIdx--;
        onbNormalizarEtapaUsuario(-1);
        onbRenderStep();
    }
}

function onbAtualizarStepper() {
    const wrap = $('onbSteps');
    if (!wrap) return;
    wrap.innerHTML = ONB_ETAPAS.map((_, i) => {
        const cls = i < onbState.etapaIdx ? 'done' : (i === onbState.etapaIdx ? 'current' : '');
        return `<div class="onb-step ${cls}"></div>`;
    }).join('');
}

function onbRenderStep() {
    onbNormalizarEtapaUsuario(1);
    onbAtualizarStepper();
    const etapa = ONB_ETAPAS[onbState.etapaIdx];
    const body = $('onbBody');
    const btnVoltar = $('onbBtnVoltar');
    const btnAvancar = $('onbBtnAvancar');

    if (btnVoltar) btnVoltar.style.display = onbState.etapaIdx === 0 ? 'none' : '';
    if (btnAvancar) btnAvancar.textContent = etapa === 'final' ? 'Ir para o Dashboard' : 'Avançar';

    const renderers = {
        boasvindas: onbRenderBoasVindas,
        cliente: onbRenderCliente,
        whatsapp: onbRenderWhatsapp,
        rastreamento: onbRenderRastreamento,
        kanban: onbRenderKanban,
        conversao: onbRenderConversao,
        final: onbRenderFinal,
    };
    body.innerHTML = '';
    (renderers[etapa] || onbRenderBoasVindas)(body);
    if (window.lucide) lucide.createIcons({ nodes: [body] });
}

// ── Etapa 1: Boas-vindas + tipo de usuário ───────────────────────
function onbRenderBoasVindas(body) {
    body.innerHTML = `
        <h3>Bem-vindo ao ${window.BRAND_NAME || 'Adlytics'}</h3>
        <p class="onb-sub">Vamos deixar seu rastreamento funcionando em poucos passos.</p>
        <div class="onb-perfil-grid">
            ${onbPerfilCard('agencia', 'building-2', 'Agência')}
            ${onbPerfilCard('empresa', 'store', 'Empresa')}
            ${onbPerfilCard('gestor_trafego', 'trending-up', 'Gestor de tráfego')}
        </div>
    `;
    onbAtualizarBotaoAvancar();
}

function onbPerfilCard(valor, icone, label) {
    const selected = onbState.perfil === valor ? 'selected' : '';
    return `<div class="onb-perfil-card ${selected}" onclick="onbEscolherPerfil('${valor}')">
        <i data-lucide="${icone}" style="width:26px;height:26px;"></i>
        <div class="onb-perfil-label">${label}</div>
    </div>`;
}

function onbEscolherPerfil(valor) {
    onbState.perfil = valor;
    onbRenderStep();
    // Salva de forma otimista — sobrevive a um fechamento abrupto do navegador.
    authFetch('/api/me-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_perfil: valor }),
    }).catch(() => {});
}

function onbAtualizarBotaoAvancar() {
    const btn = $('onbBtnAvancar');
    if (!btn) return;
    const etapa = ONB_ETAPAS[onbState.etapaIdx];
    btn.disabled = etapa === 'boasvindas' && !onbState.perfil;
}

// ── Etapa 2: Cadastro do primeiro cliente ────────────────────────
function onbRenderCliente(body) {
    const t = onbTextos();
    body.innerHTML = `
        <h3>${t.cliente_titulo}</h3>
        <p class="onb-sub">${t.cliente_sub}</p>
        <div class="onb-field"><label>Nome da empresa/loja (opcional)</label><input type="text" id="novoCliNome"></div>
        <div class="onb-field"><label>Pixel Meta (opcional)</label><input type="text" id="novoCliPixel"></div>
        <div class="onb-field"><label>E-mail de acesso *</label><input type="email" id="novoCliEmail"></div>
        <div class="onb-field"><label>Senha *</label><input type="password" id="novoCliSenha"></div>
        <button class="onb-btn onb-btn-primary" id="onbBtnSalvarCliente" onclick="onbSalvarCliente()">Criar cliente</button>
        <div id="onbClienteCredenciais"></div>
    `;
    onbAtualizarBotaoAvancar();
    const btn = $('onbBtnAvancar');
    if (btn) btn.disabled = !onbState.clienteId;
}

async function onbSalvarCliente() {
    const btn = $('onbBtnSalvarCliente');
    const original = btn.textContent;
    btn.textContent = 'Salvando...'; btn.disabled = true;

    const email = $('novoCliEmail').value.trim();
    const senha = $('novoCliSenha').value;

    try {
        await salvarNovoCliente();
        // salvarNovoCliente() abre #modalCredenciais por cima — fecha, pois o
        // wizard já mostra o mesmo conteúdo embutido, evitando 2 overlays.
        $('modalCredenciais')?.classList.remove('open');

        if (window._ultimoClienteCriadoId) {
            onbState.clienteId = window._ultimoClienteCriadoId;
            clienteAdminSelecionado = onbState.clienteId; // resolve dependência das etapas 3/4
            try { localStorage.setItem('adlytics_cliente_admin', String(clienteAdminSelecionado)); } catch (e) {}

            $('onbClienteCredenciais').innerHTML = `
                <div class="onb-success-box">
                    <div class="onb-success-row"><span>E-mail</span><strong>${esc(email)}</strong></div>
                    <div class="onb-success-row"><span>Senha</span><strong>${esc(senha)}</strong></div>
                </div>
            `;
            const avancarBtn = $('onbBtnAvancar');
            if (avancarBtn) avancarBtn.disabled = false;
            setTimeout(() => onbAvancar(), 900);
        }
    } catch (e) {
        // salvarNovoCliente() já mostra o toast de erro.
    } finally {
        btn.textContent = original; btn.disabled = false;
    }
}

// ── Etapa 3: Conectar WhatsApp ────────────────────────────────────
function onbRenderWhatsapp(body) {
    body.innerHTML = `
        <h3>Conectar o WhatsApp</h3>
        <p class="onb-sub">Gere o QR Code e escaneie com o celular do número que vai atender os leads.</p>
        <div id="onbWaCreate">
            <div class="onb-field"><label>Nome da conexão</label><input type="text" id="waInstanceName" placeholder="Ex: comercial-01"></div>
            <button class="onb-btn onb-btn-primary" id="btnGerarQr" onclick="waCreateInstance()">Gerar QR Code</button>
        </div>
        <div id="waQrView" style="display:none;text-align:center;margin-top:16px;">
            <p id="waQrTitle" style="font-weight:700;margin-bottom:12px;"></p>
            <img id="waQrImage" style="display:none;max-width:220px;border-radius:12px;">
            <p id="waWaitQr" style="color:var(--muted);font-size:13px;">Aguardando leitura do QR Code…</p>
            <p id="waQrCountdown" style="color:var(--muted);font-size:12px;margin-top:8px;"></p>
            <div style="max-width:320px;margin:12px auto 0;text-align:left;background:var(--hover);border-radius:10px;padding:12px 14px;">
                <ol style="font-size:12px;color:var(--muted);line-height:1.7;padding-left:18px;margin:0;">
                    <li>Abra o WhatsApp no celular do número que vai atender.</li>
                    <li>Toque no menu (⋮) ou, no iPhone, em Configurações.</li>
                    <li>Toque em Aparelhos conectados → Conectar um aparelho.</li>
                    <li>Aponte a câmera para o QR Code acima.</li>
                </ol>
            </div>
            <button class="onb-btn onb-btn-ghost" id="btnCompartilharWa" onclick="compartilharQrComResponsavel()" style="display:none;margin-top:10px;">
                <i data-lucide="share-2" style="width:14px;height:14px;"></i> Compartilhar com o responsável
            </button>
        </div>
        <div id="waConnectedView" style="display:none;text-align:center;margin-top:16px;">
            <i data-lucide="check-circle" style="width:40px;height:40px;color:var(--green);"></i>
            <p style="font-weight:700;margin-top:10px;">WhatsApp conectado!</p>
        </div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [body] });
    onbObservarConexaoWa();
}

// checkWaStatus() (js/admin.js) já detecta conexão aberta e chama
// setWaView('waConnectedView'), que torna #waConnectedView visível — em vez
// de sobrescrever setWaView (arriscado: ela também controla #waList/
// #btnNovaConexao, que não existem no wizard), observamos a própria
// visibilidade do elemento, que já é o efeito colateral existente e estável.
function onbObservarConexaoWa() {
    const el = $('waConnectedView');
    if (!el) return;
    const observer = new MutationObserver(() => {
        if (el.style.display !== 'none' && ONB_ETAPAS[onbState.etapaIdx] === 'whatsapp') {
            observer.disconnect();
            const btn = $('onbBtnAvancar');
            if (btn) btn.disabled = false;
            setTimeout(() => onbAvancar(), 1200);
        }
    });
    observer.observe(el, { attributes: true, attributeFilter: ['style'] });
}

// ── Etapa 4: Criar rastreamento e testar ─────────────────────────
function onbRenderRastreamento(body) {
    body.innerHTML = `
        <h3>Crie seu primeiro link rastreável</h3>
        <p class="onb-sub">O link leva o clique direto pro WhatsApp e já registra de onde veio o lead.</p>
        <div class="onb-action-card">
            <div class="onb-action-text">
                <strong>Nenhum link criado ainda</strong>
                <span>Configure origem, mensagem e número de destino.</span>
            </div>
            <button class="onb-btn onb-btn-primary" onclick="onbAbrirModalLink()">Criar meu primeiro link</button>
        </div>
        <div id="onbTestLinkArea"></div>
    `;
    const btn = $('onbBtnAvancar');
    if (btn) btn.disabled = !onbState.ultimoSlugCriado;
}

function onbAbrirModalLink() {
    abrirModalCampanha();
    // Detecta o fechamento do modal (salvo com sucesso) observando a lista de
    // campanhas carregadas — sem duplicar a lógica de salvamento existente.
    const overlay = $('modalCampanha');
    if (!overlay) return;
    const observer = new MutationObserver(() => {
        if (!overlay.classList.contains('open')) {
            observer.disconnect();
            onbDetectarLinkCriado();
        }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
}

function onbDetectarLinkCriado() {
    const lista = window._capCampanhas || [];
    if (!lista.length) return;
    const maisRecente = lista[0];
    if (!maisRecente?.slug) return;
    onbState.ultimoSlugCriado = maisRecente.slug;

    const body = $('onbBody');
    if (!body || ONB_ETAPAS[onbState.etapaIdx] !== 'rastreamento') return;
    body.querySelector('.onb-action-card').outerHTML = `
        <div class="onb-action-card">
            <div class="onb-action-text">
                <strong>Link criado: ${esc(maisRecente.name || maisRecente.slug)}</strong>
                <span>Confirme se ele está funcionando antes de seguir.</span>
            </div>
            <button class="onb-btn onb-btn-primary" onclick="onbTestarLink()">Testar rastreamento</button>
        </div>
    `;
    const btn = $('onbBtnAvancar');
    if (btn) btn.disabled = false;
}

async function onbTestarLink() {
    const area = $('onbTestLinkArea');
    area.innerHTML = `<div class="onb-test-result">Testando…</div>`;
    try {
        const r = await authFetch(`/api/onboarding-test-link?slug=${encodeURIComponent(onbState.ultimoSlugCriado)}`);
        const data = await r.json();
        area.innerHTML = `<div class="onb-test-result ${data.ok ? 'ok' : 'fail'}">
            <i data-lucide="${data.ok ? 'check-circle' : 'x-circle'}" style="width:16px;height:16px;"></i>
            ${esc(data.motivo)}
        </div>`;
        if (window.lucide) lucide.createIcons({ nodes: [area] });
    } catch (e) {
        area.innerHTML = `<div class="onb-test-result fail">Não foi possível testar agora.</div>`;
    }
}

// ── Etapa 5: Kanban (só explicativo) ──────────────────────────────
function onbRenderKanban(body) {
    body.innerHTML = `
        <h3>Organize seus leads no funil</h3>
        <p class="onb-sub">Seus leads passam por 5 etapas: Lead, Qualificado, Agendado, Vendido, Perdido. Arraste os cards conforme o atendimento avança.</p>
        <button class="onb-btn onb-btn-primary" onclick="onbVerKanban()">Ver meu Kanban agora</button>
    `;
    const btn = $('onbBtnAvancar');
    if (btn) btn.disabled = false;
}

function onbVerKanban() {
    $('onboardingWizard').classList.remove('open');
    mudarAba('leads');
    setLeadsViewMode('kanban');
}

// ── Etapa 6: Configurar conversão ─────────────────────────────────
function onbRenderConversao(body) {
    body.innerHTML = `
        <h3>Configure sua conversão (opcional)</h3>
        <p class="onb-sub">Diga à Meta e ao Google quando um lead vira uma conversão de verdade. Pode configurar isso depois com calma.</p>
        <div class="onb-action-card">
            <div class="onb-action-text"><strong>Meta / CAPI</strong><span>Rastreamento inteligente por palavra-chave.</span></div>
            <button class="onb-btn onb-btn-ghost" onclick="onbConfigurarMeta()">Configurar Meta</button>
        </div>
        <div class="onb-action-card">
            <div class="onb-action-text"><strong>Google Ads</strong><span>ID e rótulo de conversão.</span></div>
            <button class="onb-btn onb-btn-ghost" onclick="onbConfigurarGoogle()">Configurar Google Ads</button>
        </div>
    `;
    const btn = $('onbBtnAvancar');
    if (btn) btn.disabled = false;
}

function onbConfigurarMeta() {
    $('onboardingWizard').classList.remove('open');
    mudarAba('inteligente');
}

function onbConfigurarGoogle() {
    $('onboardingWizard').classList.remove('open');
    abrirEditCliente(onbState.clienteId, 'google');
}

// ── Etapa 7: Resultado final ──────────────────────────────────────
async function onbRenderFinal(body) {
    body.innerHTML = `<h3>Verificando seu progresso…</h3>`;
    let status = {};
    try {
        const r = await authFetch('/api/onboarding-status' + (onbState.clienteId ? `?cliente_id=${onbState.clienteId}` : ''));
        if (r.ok) status = await r.json();
    } catch (e) { /* mostra o que der */ }

    body.innerHTML = `
        <h3>Seu ${window.BRAND_NAME || 'Adlytics'} está funcionando</h3>
        <p class="onb-sub">Aqui está o que já foi confirmado de verdade:</p>
        ${ONB_MARCOS.map(([chave, label]) => `
            <div class="onb-checklist-item ${status[chave] ? 'done' : ''}">
                <span class="onb-dot"></span>${esc(label)}
            </div>
        `).join('')}
    `;
    const btn = $('onbBtnAvancar');
    if (btn) btn.disabled = false;
    onbAtualizarChecklistBadge(status);
}

async function onbConcluir() {
    try {
        await authFetch('/api/me-update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ onboarding_completo: true }),
        });
    } catch (e) { /* best-effort */ }
    $('onboardingWizard').classList.remove('open');
    $('onbChecklistBadge')?.classList.remove('visible');
}

// Botão "Avançar" no rodapé: na última etapa, conclui; nas demais, avança.
function onbAvancarOuConcluir() {
    if (ONB_ETAPAS[onbState.etapaIdx] === 'final') onbConcluir();
    else onbAvancar();
}

// ── Checklist persistente (badge flutuante) ───────────────────────
async function onbAtualizarChecklistBadge(statusJaCarregado) {
    const badge = $('onbChecklistBadge');
    if (!badge) return;

    let status = statusJaCarregado;
    if (!status) {
        try {
            const r = await authFetch('/api/onboarding-status' + (onbState.clienteId ? `?cliente_id=${onbState.clienteId}` : ''));
            if (r.ok) status = await r.json();
        } catch (e) { return; }
    }
    if (!status) return;

    const concluidos = ONB_MARCOS.filter(([chave]) => status[chave]).length;

    if (concluidos >= ONB_MARCOS.length) {
        badge.classList.remove('visible');
        return;
    }
    badge.classList.add('visible');
    $('onbBadgeCount').textContent = `${concluidos}/${ONB_MARCOS.length}`;
    $('onbBadgeItens').innerHTML = ONB_MARCOS.map(([chave, label]) => `
        <div class="onb-checklist-item ${status[chave] ? 'done' : ''}">
            <span class="onb-dot"></span>${esc(label)}
        </div>
    `).join('');
}

function onbToggleBadgePanel() {
    $('onbBadgePanel')?.classList.toggle('open');
}

function onbContinuarDoChecklist() {
    $('onbBadgePanel')?.classList.remove('open');
    const user = JSON.parse(localStorage.getItem('adlytics_user') || '{}');
    abrirWizardOnboarding(user);
}
