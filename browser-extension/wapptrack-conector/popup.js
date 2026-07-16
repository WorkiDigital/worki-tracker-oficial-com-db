const elements = {
  closeSourceTab: document.querySelector('#closeSourceTab'),
  connectButton: document.querySelector('#connectButton'),
  connectionProgress: document.querySelector('#connectionProgress'),
  feedback: document.querySelector('#feedback'),
  formSection: document.querySelector('#formSection'),
  openWhatsAppButton: document.querySelector('#openWhatsAppButton'),
  pairingSection: document.querySelector('#pairingSection'),
  platformCode: document.querySelector('#platformCode'),
  statusDot: document.querySelector('#statusDot'),
  transferConsent: document.querySelector('#transferConsent'),
  waDetail: document.querySelector('#waDetail'),
  waStatus: document.querySelector('#waStatus'),
};

let whatsappReady = false;
let accessToken = null;
let transferRequestId = null;
let sourceTabId = null;
let pollingTimer = null;

const ERROR_MESSAGES = Object.freeze({
  AUTHENTICATION_FAILED: 'A autorização temporária expirou. Gere um novo código.',
  BACKEND_ORIGIN_INVALID: 'Configure corretamente o domínio HTTPS do backend.',
  CONTENT_SCRIPT_UNAVAILABLE: 'Recarregue a aba do WhatsApp Web e tente novamente.',
  EVOLUTION_CONNECT_FAILED: 'A Evolution não conseguiu carregar a sessão. A alteração foi revertida.',
  EVOLUTION_CONNECTION_TIMEOUT: 'A Evolution não confirmou a conexão. A alteração foi revertida.',
  INVALID_CREDS_STRUCTURE: 'A sessão extraída não é compatível com esta versão da Evolution.',
  NOISE_KEY_MISSING: 'O WhatsApp Web não disponibilizou a chave necessária.',
  NOISE_KEY_NOT_VALIDATED: 'Não foi possível validar a sessão localmente.',
  PHONE_MISMATCH: 'O número extraído não corresponde ao número autorizado.',
  PHONE_NOT_DETECTED: 'Não foi possível identificar o número conectado.',
  PLATFORM_CODE_INVALID: 'Informe o código completo exibido na plataforma.',
  REQUEST_TIMEOUT: 'O servidor demorou para responder. Tente novamente.',
  SESSION_DATA_INCOMPLETE: 'O WhatsApp Web ainda não terminou de carregar a sessão.',
  SESSION_EXTRACTION_FAILED: 'Não foi possível preparar a sessão. Recarregue o WhatsApp Web.',
  TOKEN_INVALID: 'A autorização temporária é inválida.',
  TRANSFER_CODE_EXPIRED: 'Este código expirou. Gere outro na plataforma.',
  TRANSFER_CODE_INVALID: 'Código inválido. Confira e tente novamente.',
  TRANSFER_CODE_USED: 'Este código já foi utilizado.',
  WHATSAPP_NOT_LOGGED_IN: 'Conclua o login no WhatsApp Web antes de continuar.',
  WHATSAPP_TAB_REQUIRED: 'Abra a extensão dentro da aba web.whatsapp.com.',
});

function message(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function setFeedback(text = '', success = false) {
  elements.feedback.textContent = text;
  elements.feedback.classList.toggle('hidden', !text);
  elements.feedback.classList.toggle('success', Boolean(success));
}

function errorText(code) {
  return ERROR_MESSAGES[code] || 'Não foi possível concluir a transferência.';
}

function normalizedPlatformCode() {
  return elements.platformCode.value.trim().toUpperCase();
}

function updateButton() {
  const codeValid = /^[A-Z0-9-]{8,32}$/.test(normalizedPlatformCode());
  elements.connectButton.disabled = !whatsappReady || !codeValid || !elements.transferConsent.checked;
}

function showWhatsAppStatus(loggedIn, detail = '') {
  whatsappReady = loggedIn;
  elements.statusDot.className = `dot ${loggedIn ? 'dot-online' : 'dot-offline'}`;
  elements.waStatus.textContent = loggedIn
    ? 'WhatsApp Web conectado'
    : 'WhatsApp Web não está conectado';
  elements.waDetail.textContent = detail || (loggedIn
    ? 'Sessão autenticada detectada. Confirme a transferência.'
    : 'Faça login com o celular e conclua a Passkey, se solicitada.');
  elements.openWhatsAppButton.classList.toggle('hidden', loggedIn);
  updateButton();
}

async function loadWhatsAppStatus() {
  const response = await message('WAPPTRACK_GET_WA_STATUS');
  if (!response?.ok) {
    showWhatsAppStatus(false, errorText(response?.error?.code));
    return;
  }
  showWhatsAppStatus(Boolean(response.data?.loggedIn));
}

function stopPolling() {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
}

async function pollStatus() {
  if (!accessToken || !transferRequestId) return;
  const response = await message('WAPPTRACK_TRANSFER_STATUS', {
    accessToken,
    transferRequestId,
    sourceTabId,
    closeSourceTab: elements.closeSourceTab.checked,
  });

  if (!response?.ok) {
    const code = response?.error?.code;
    if (['AUTHENTICATION_FAILED', 'HTTP_404'].includes(code)) {
      stopPolling();
      setFeedback(errorText(code));
      return;
    }
  } else {
    const status = String(response.data?.status || '').toUpperCase();
    if (status === 'CONNECTED') {
      stopPolling();
      elements.connectionProgress.textContent = 'Conexão confirmada pela Evolution.';
      setFeedback(
        elements.closeSourceTab.checked
          ? 'Sessão transferida. A aba original foi fechada.'
          : 'Sessão transferida. Feche a aba original para evitar conflito.',
        true,
      );
      accessToken = null;
      return;
    }
    if (['EXPIRED', 'FAILED', 'ERROR'].includes(status)) {
      stopPolling();
      elements.connectionProgress.textContent = 'A transferência foi revertida.';
      setFeedback(errorText(response.data?.errorCode || status));
      accessToken = null;
      return;
    }
  }

  pollingTimer = setTimeout(pollStatus, 3000);
}

async function startTransfer() {
  setFeedback();
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = 'Preparando sessão…';

  try {
    const result = await message('WAPPTRACK_TRANSFER_SESSION', {
      platformCode: normalizedPlatformCode(),
    });
    if (!result?.ok) throw result?.error || { code: 'UNEXPECTED_ERROR' };

    accessToken = result.data?.accessToken;
    transferRequestId = result.data?.transferRequestId;
    sourceTabId = result.data?.sourceTabId;
    if (!accessToken || !transferRequestId) {
      throw { code: 'UNEXPECTED_ERROR' };
    }

    elements.formSection.classList.add('hidden');
    elements.pairingSection.classList.remove('hidden');
    elements.connectionProgress.textContent = 'Aguardando confirmação da Evolution…';
    pollStatus();
  } catch (error) {
    accessToken = null;
    transferRequestId = null;
    setFeedback(errorText(error?.code));
    updateButton();
  } finally {
    elements.connectButton.textContent = 'Transferir sessão';
  }
}

elements.platformCode.addEventListener('input', () => {
  elements.platformCode.value = normalizedPlatformCode();
  updateButton();
});
elements.transferConsent.addEventListener('change', updateButton);
elements.connectButton.addEventListener('click', startTransfer);
elements.openWhatsAppButton.addEventListener('click', () => message('WAPPTRACK_OPEN_WA'));
window.addEventListener('unload', stopPolling);
loadWhatsAppStatus().catch(() => showWhatsAppStatus(false));
