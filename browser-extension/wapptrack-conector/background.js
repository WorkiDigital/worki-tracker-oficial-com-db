import {
  API_PATHS,
  BACKEND_ORIGIN,
  REQUEST_TIMEOUT_MS,
} from './config.js';
import {
  buildEvolutionCredsJson,
  extractWhatsAppSession,
} from './session-transfer.js';

const BACKEND = new URL(BACKEND_ORIGIN);

function isWhatsAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'web.whatsapp.com';
  } catch {
    return false;
  }
}

function backendUrl(pathname, operationId = '') {
  const suffix = operationId ? `/${encodeURIComponent(operationId)}` : '';
  const url = new URL(`${pathname}${suffix}`, BACKEND);
  if (url.protocol !== 'https:' || url.origin !== BACKEND.origin) {
    throw Object.assign(new Error('BACKEND_ORIGIN_INVALID'), {
      code: 'BACKEND_ORIGIN_INVALID',
    });
  }
  return url;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Extension-Version': chrome.runtime.getManifest().version,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error('REQUEST_FAILED');
      error.code = body?.code || `HTTP_${response.status}`;
      error.status = response.status;
      error.reason = body?.reason;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('REQUEST_TIMEOUT'), {
        code: 'REQUEST_TIMEOUT',
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function activeWhatsAppTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isWhatsAppUrl(tab.url)) {
    throw Object.assign(new Error('WHATSAPP_TAB_REQUIRED'), {
      code: 'WHATSAPP_TAB_REQUIRED',
    });
  }
  return tab;
}

async function getWhatsAppStatus() {
  const tab = await activeWhatsAppTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'WAPPTRACK_CONTENT_STATUS',
    });
  } catch {
    throw Object.assign(new Error('CONTENT_SCRIPT_UNAVAILABLE'), {
      code: 'CONTENT_SCRIPT_UNAVAILABLE',
    });
  }
}

function bearer(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    throw Object.assign(new Error('TOKEN_INVALID'), { code: 'TOKEN_INVALID' });
  }
  return { Authorization: `Bearer ${token}` };
}

function safeError(error) {
  return {
    ok: false,
    error: {
      code: error?.code || error?.message || 'UNEXPECTED_ERROR',
      status: Number.isInteger(error?.status) ? error.status : undefined,
      reason: error?.reason,
    },
  };
}

async function extractAuthorizedSession(tab) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: extractWhatsAppSession,
  });
  const result = results?.[0]?.result;
  if (!result?.success || !result?.data) {
    throw Object.assign(new Error('SESSION_EXTRACTION_FAILED'), {
      code: 'SESSION_EXTRACTION_FAILED',
    });
  }
  return buildEvolutionCredsJson(result.data);
}

async function transferSession(platformCode) {
  const code = String(platformCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{8,32}$/.test(code)) {
    throw Object.assign(new Error('PLATFORM_CODE_INVALID'), {
      code: 'PLATFORM_CODE_INVALID',
    });
  }

  const tab = await activeWhatsAppTab();
  const status = await getWhatsAppStatus();
  if (!status?.loggedIn) {
    throw Object.assign(new Error('WHATSAPP_NOT_LOGGED_IN'), {
      code: 'WHATSAPP_NOT_LOGGED_IN',
    });
  }

  const extracted = await extractAuthorizedSession(tab);
  const exchange = await fetchJson(backendUrl(API_PATHS.exchange), {
    method: 'POST',
    body: JSON.stringify({
      code,
      whatsapp: {
        status: 'LOGGED_IN',
        detectedPhone: extracted.detectedPhone,
      },
    }),
  });
  const accessToken = exchange?.accessToken;
  const transferRequestId = exchange?.transferRequestId;
  if (!accessToken || !transferRequestId) {
    throw Object.assign(new Error('TRANSFER_EXCHANGE_INVALID'), {
      code: 'TRANSFER_EXCHANGE_INVALID',
    });
  }

  await fetchJson(backendUrl(API_PATHS.upload), {
    method: 'POST',
    headers: bearer(accessToken),
    body: JSON.stringify({
      transferRequestId,
      credsJson: extracted.credsJson,
    }),
  });

  const imported = await fetchJson(backendUrl(API_PATHS.importSession), {
    method: 'POST',
    headers: bearer(accessToken),
    body: JSON.stringify({ transferRequestId }),
  });

  return {
    accessToken,
    transferRequestId,
    sourceTabId: tab.id,
    status: imported?.status || 'CONNECTING',
  };
}

async function closeSourceTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isWhatsAppUrl(tab?.url)) await chrome.tabs.remove(tabId);
  } catch {
    // A aba já foi fechada pelo usuário.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = (async () => {
    if (!message || typeof message.type !== 'string') {
      throw Object.assign(new Error('MESSAGE_INVALID'), { code: 'MESSAGE_INVALID' });
    }

    if (message.type === 'WAPPTRACK_GET_WA_STATUS') {
      return { ok: true, data: await getWhatsAppStatus() };
    }
    if (message.type === 'WAPPTRACK_OPEN_WA') {
      await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
      return { ok: true };
    }
    if (message.type === 'WAPPTRACK_TRANSFER_SESSION') {
      return { ok: true, data: await transferSession(message.platformCode) };
    }
    if (message.type === 'WAPPTRACK_TRANSFER_STATUS') {
      const data = await fetchJson(
        backendUrl(API_PATHS.status, message.transferRequestId),
        {
          method: 'GET',
          headers: bearer(message.accessToken),
        },
      );
      if (data?.status === 'CONNECTED' && message.closeSourceTab === true) {
        await closeSourceTab(message.sourceTabId);
      }
      return { ok: true, data };
    }

    throw Object.assign(new Error('MESSAGE_NOT_SUPPORTED'), {
      code: 'MESSAGE_NOT_SUPPORTED',
    });
  })();

  task.then(sendResponse).catch(error => sendResponse(safeError(error)));
  return true;
});
