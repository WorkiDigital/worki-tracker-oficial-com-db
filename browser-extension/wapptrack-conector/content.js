(() => {
  const LOGIN_SELECTORS = [
    '#pane-side',
    '[data-testid="chat-list"]',
    '[aria-label="Lista de conversas"]',
    '[aria-label="Chat list"]',
  ];

  const LOGOUT_SELECTORS = [
    '[data-ref] canvas',
    '[data-testid="qrcode"]',
    'canvas[aria-label*="QR"]',
  ];

  function anySelector(selectors) {
    return selectors.some((selector) => document.querySelector(selector));
  }

  function detectStatus() {
    const hasLoginUi = anySelector(LOGIN_SELECTORS);
    const hasQrCode = anySelector(LOGOUT_SELECTORS);

    return {
      loggedIn: hasLoginUi && !hasQrCode,
      detectedPhone: null,
      pageOrigin: window.location.origin,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'WAPPTRACK_CONTENT_STATUS') return false;
    sendResponse(detectStatus());
    return false;
  });

  let previousLoggedIn = null;
  const observer = new MutationObserver(() => {
    const status = detectStatus();
    if (status.loggedIn === previousLoggedIn) return;
    previousLoggedIn = status.loggedIn;
    chrome.runtime.sendMessage({
      type: 'WAPPTRACK_WA_STATUS_CHANGED',
      loggedIn: status.loggedIn,
    }).catch(() => {});
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
