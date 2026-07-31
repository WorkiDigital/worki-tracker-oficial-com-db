// Página pública de conexão remota do WhatsApp (wa-connect.html).
// Sem login, sem sidebar — só lê o token da URL, mostra o QR já gerado pelo
// painel e faz polling até detectar conexão ou o link expirar de vez.
// O QR individual expira rápido (a Evolution renova o código a cada ~1min),
// mas o próprio backend (api/wa-connect-public.js) busca um QR novo sozinho
// quando isso acontece — o link inteiro (link_expires_at) dura bem mais.
// Nunca expõe nenhuma ação (delete/logout/etc), é 100% leitura.
(function () {
    'use strict';

    // Esta página não carrega js/utils.js — apiUrl() local, mesmo padrão do
    // login.html. window.APP_CONFIG vem de /runtime-config.js (carregado no
    // <head> de wa-connect.html, sem defer, antes deste script).
    function apiUrl(path) {
        const baseUrl = window.APP_CONFIG?.API_BASE_URL || window.API_BASE_URL || '';
        const normalizedBase = baseUrl.replace(/\/+$/, '');
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return `${normalizedBase}${normalizedPath}`;
    }

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const conteudo = document.getElementById('conteudo');

    let pollTimer = null;
    let countdownTimer = null;
    let ultimoQrBase64 = null;

    function renderErro(msg) {
        pararPolling();
        conteudo.innerHTML = `<p class="estado erro">${escapeHtml(msg)}</p>`;
    }

    function renderSucesso() {
        pararPolling();
        conteudo.innerHTML = `<p class="estado sucesso">✓ WhatsApp conectado com sucesso!</p>`;
    }

    function renderQr(data) {
        ultimoQrBase64 = data.qr_base64;
        conteudo.innerHTML = `
            <div class="qr-box"><img id="wcQrImg" src="${data.qr_base64}" alt="QR Code WhatsApp"></div>
            <p class="countdown" id="wcCountdown"></p>
            <div class="instrucoes">
                <ol>
                    <li>Abra o WhatsApp no celular que vai atender.</li>
                    <li>Toque no menu (⋮) ou, no iPhone, em Configurações.</li>
                    <li>Toque em Aparelhos conectados → Conectar um aparelho.</li>
                    <li>Aponte a câmera para o QR Code acima.</li>
                </ol>
            </div>
            <p class="nota">O código se renova sozinho automaticamente.</p>
        `;
        iniciarCountdown(data.qr_expires_at);
    }

    function atualizarQrSeMudou(data) {
        if (data.qr_base64 === ultimoQrBase64) return;
        ultimoQrBase64 = data.qr_base64;
        const img = document.getElementById('wcQrImg');
        if (img) img.src = data.qr_base64;
        iniciarCountdown(data.qr_expires_at);
    }

    function iniciarCountdown(expiresAtIso) {
        clearInterval(countdownTimer);
        const el = document.getElementById('wcCountdown');
        if (!el) return;
        const atualizar = () => {
            const restanteMs = new Date(expiresAtIso).getTime() - Date.now();
            if (restanteMs <= 0) {
                el.textContent = 'Renovando código...';
                clearInterval(countdownTimer);
                return;
            }
            const seg = Math.ceil(restanteMs / 1000);
            el.textContent = `Código válido por mais ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
        };
        atualizar();
        countdownTimer = setInterval(atualizar, 1000);
    }

    function pararPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function consultar() {
        try {
            const r = await fetch(apiUrl(`/api/wa-connect-public?token=${encodeURIComponent(token)}`));
            const data = await r.json();
            if (!r.ok) {
                renderErro(data.error || 'Não foi possível carregar o link.');
                return;
            }
            if (data.connected) {
                renderSucesso();
                return;
            }
            // Desenha o QR na primeira vez; nas próximas só troca a imagem se o
            // backend tiver renovado o código (evita piscar a tela a cada poll).
            if (!document.querySelector('.qr-box')) renderQr(data);
            else atualizarQrSeMudou(data);
        } catch (e) {
            // Falha de rede pontual não deve interromper o polling.
        }
    }

    function init() {
        if (!token) {
            renderErro('Link inválido — falta o identificador de conexão.');
            return;
        }
        consultar();
        pollTimer = setInterval(consultar, 4000);
    }

    init();
})();
