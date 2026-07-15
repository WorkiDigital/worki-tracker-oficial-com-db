// Página pública de conexão remota do WhatsApp (wa-connect.html).
// Sem login, sem sidebar — só lê o token da URL, mostra o QR já gerado pelo
// painel e faz polling limitado até detectar conexão ou o link expirar.
// Nunca expõe nenhuma ação (delete/logout/etc), é 100% leitura.
(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const conteudo = document.getElementById('conteudo');

    let pollTimer = null;
    let countdownTimer = null;

    function renderErro(msg) {
        pararPolling();
        conteudo.innerHTML = `<p class="estado erro">${escapeHtml(msg)}</p>`;
    }

    function renderSucesso() {
        pararPolling();
        conteudo.innerHTML = `<p class="estado sucesso">✓ WhatsApp conectado com sucesso!</p>`;
    }

    function renderQr(data) {
        conteudo.innerHTML = `
            <div class="qr-box"><img src="${data.qr_base64}" alt="QR Code WhatsApp"></div>
            <p class="countdown" id="wcCountdown"></p>
            <div class="instrucoes">
                <ol>
                    <li>Abra o WhatsApp no celular que vai atender.</li>
                    <li>Toque no menu (⋮) ou, no iPhone, em Configurações.</li>
                    <li>Toque em Aparelhos conectados → Conectar um aparelho.</li>
                    <li>Aponte a câmera para o QR Code acima.</li>
                </ol>
            </div>
            <p class="nota">Se o código não funcionar, peça um novo link.</p>
        `;
        iniciarCountdown(data.expires_at);
    }

    function iniciarCountdown(expiresAtIso) {
        clearInterval(countdownTimer);
        const el = document.getElementById('wcCountdown');
        if (!el) return;
        const atualizar = () => {
            const restanteMs = new Date(expiresAtIso).getTime() - Date.now();
            if (restanteMs <= 0) {
                el.textContent = 'Expirado';
                clearInterval(countdownTimer);
                return;
            }
            const seg = Math.ceil(restanteMs / 1000);
            el.textContent = `Expira em ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
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
            const r = await fetch(`/api/wa-connect-public?token=${encodeURIComponent(token)}`);
            const data = await r.json();
            if (!r.ok) {
                renderErro(data.error || 'Não foi possível carregar o link.');
                return;
            }
            if (data.connected) {
                renderSucesso();
                return;
            }
            // Só remonta o QR se ainda não estiver desenhado (evita piscar a cada poll).
            if (!document.querySelector('.qr-box')) renderQr(data);
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
