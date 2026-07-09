/**
 * Script público de rastreamento para sites externos (Anúncio > Site > WhatsApp).
 * Instalação:
 *   <script src="https://SEU-DOMINIO/js/wapptrack.js" data-campaign="slug-da-campanha"></script>
 *   <a href="#" data-wapptrack-button>Chamar no WhatsApp</a>
 *
 * O script:
 *  1. Lê data-campaign, captura UTMs/fbclid/_fbp/URL/título/referrer.
 *  2. Registra um PageView (/api/site-pageview) e guarda o visitor_id.
 *  3. Nos botões [data-wapptrack-button], intercepta o clique, resolve o
 *     destino do WhatsApp (/api/site-whatsapp-click) e abre o WhatsApp.
 *  4. Se a campanha tiver um texto de botão configurado no painel, escreve
 *     esse texto no botão automaticamente. Em botões com ícone + texto (ex:
 *     <button><Icon/><span>Falar</span></button>), marque o texto com
 *     data-wapptrack-label para o script trocar só ele, preservando o ícone.
 *  5. Se o cliente tiver ID/label de conversão do Google Ads configurados E o
 *     clique tiver vindo com ?gclid=... na URL, dispara a conversão via gtag.js
 *     (client-side, sem GTM) no momento do clique no botão.
 *
 * A conversão de LEAD (clique → lead) continua sendo feita pelo webhook existente
 * quando a mensagem chega no WhatsApp — este script só origina o clique. A conversão
 * de Google Ads é exceção: dispara no clique mesmo, pois aqui não há página
 * intermediária (diferente do link /r/<slug>, que tem tempo de sobra para o gtag).
 */
(function () {
  'use strict';

  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var campaign = currentScript.getAttribute('data-campaign');
  if (!campaign) {
    console.warn('[wapptrack] data-campaign não informado no <script>.');
    return;
  }

  var API_BASE = (function () {
    try {
      var src = currentScript.src;
      var u = new URL(src);
      return u.origin;
    } catch (e) { return ''; }
  })();

  var VISITOR_KEY = 'wapptrack_visitor_id';
  var VISITOR_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

  function getStoredVisitor() {
    try {
      var raw = localStorage.getItem(VISITOR_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data.id || !data.ts || (Date.now() - data.ts) > VISITOR_TTL_MS) return null;
      return data.id;
    } catch (e) { return null; }
  }

  function setStoredVisitor(id) {
    try { localStorage.setItem(VISITOR_KEY, JSON.stringify({ id: id, ts: Date.now() })); }
    catch (e) { /* localStorage indisponível (modo privado etc.) */ }
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function qs(name) {
    try { return new URLSearchParams(window.location.search).get(name); }
    catch (e) { return null; }
  }

  function collectParams() {
    return {
      campaign: campaign,
      page_url: window.location.href,
      page_title: document.title,
      referrer: document.referrer,
      utm_source: qs('utm_source'),
      utm_medium: qs('utm_medium'),
      utm_campaign: qs('utm_campaign'),
      utm_content: qs('utm_content'),
      fbclid: qs('fbclid'),
      fbp: getCookie('_fbp'),
      placement: qs('placement'),
      ad_id: qs('ad_id') || qs('adid'),
      adset_id: qs('adset_id'),
      meta_campaign_id: qs('meta_campaign_id') || qs('campaign_id'),
      gclid: qs('gclid'),
    };
  }

  function postJson(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  var visitorId = getStoredVisitor();
  var pixelReady = null;

  function ensurePixel(pixelId, eventId) {
    if (!pixelId || pixelReady) return;
    pixelReady = true;
    if (!window.fbq) {
      (function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = true; t.src = v;
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    }
    try {
      window.fbq('init', pixelId);
      window.fbq('track', 'PageView', {}, { eventID: eventId });
    } catch (e) { /* best-effort */ }
  }

  // Guarda as credenciais Google Ads (devolvidas pelo /api/site-pageview, já filtradas
  // pelo backend: só vêm preenchidas quando o clique teve gclid E o cliente configurou
  // ID/label) para disparar a conversão no CLIQUE do botão — não no PageView, porque
  // aqui não existe página intermediária: o clique já abre o WhatsApp diretamente.
  var googleAdsId = null, googleAdsLabel = null, gtagReady = null;

  function ensureGtagLib(conversionId) {
    if (gtagReady) return;
    gtagReady = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(conversionId);
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', conversionId);
  }

  function dispararConversaoGoogleAds() {
    if (!googleAdsId || !googleAdsLabel) return;
    ensureGtagLib(googleAdsId);
    try {
      window.gtag('event', 'conversion', {
        'send_to': googleAdsId + '/' + googleAdsLabel,
        'value': 1.0,
        'currency': 'BRL',
      });
    } catch (e) { /* best-effort */ }
  }

  // Escreve o texto configurado na campanha nos botões [data-wapptrack-button].
  // Não sobrescreve botões com filhos HTML (ícone + texto) a menos que exista um
  // sub-elemento [data-wapptrack-label] marcado explicitamente — evita apagar ícones.
  function aplicarTextoBotao(texto) {
    if (!texto) return;
    var botoes = document.querySelectorAll('[data-wapptrack-button]');
    for (var i = 0; i < botoes.length; i++) {
      var alvo = botoes[i].querySelector('[data-wapptrack-label]');
      if (alvo) { alvo.textContent = texto; continue; }
      if (botoes[i].children.length === 0) botoes[i].textContent = texto;
    }
  }

  function registrarPageview() {
    var params = collectParams();
    if (visitorId) params.visitor_id = visitorId;
    postJson('/api/site-pageview', params).then(function (data) {
      if (data && data.visitor_id) {
        visitorId = data.visitor_id;
        setStoredVisitor(visitorId);
      }
      if (data && data.pixel_id && data.pageview_event_id) {
        ensurePixel(data.pixel_id, data.pageview_event_id);
      }
      if (data && data.button_text) {
        aplicarTextoBotao(data.button_text);
      }
      if (data && data.google_ads_id && data.google_ads_label) {
        googleAdsId = data.google_ads_id;
        googleAdsLabel = data.google_ads_label;
      }
    }).catch(function () { /* best-effort: falha de rede não deve travar o site */ });
  }

  function abrirWhatsapp(botao) {
    var win = window.open('about:blank', '_blank'); // abre já na thread do clique (evita popup blocker)
    var params = collectParams();
    params.visitor_id = visitorId;
    var msg = botao.getAttribute('data-wapp-message');
    if (msg) params.message = msg;

    // Conversão Google Ads dispara aqui (não há página intermediária neste fluxo —
    // o clique já abre o WhatsApp direto).
    dispararConversaoGoogleAds();

    postJson('/api/site-whatsapp-click', params).then(function (data) {
      if (data && data.url) {
        if (win) { win.location = data.url; }
        else { window.location.href = data.url; }
      } else if (win) {
        win.close();
      }
    }).catch(function () {
      if (win) win.close();
    });
  }

  function ligarBotoes() {
    var botoes = document.querySelectorAll('[data-wapptrack-button]');
    for (var i = 0; i < botoes.length; i++) {
      if (botoes[i]._wapptrackBound) continue;
      botoes[i]._wapptrackBound = true;
      botoes[i].addEventListener('click', function (e) {
        e.preventDefault();
        abrirWhatsapp(this);
      });
    }
  }

  function init() {
    registrarPageview();
    ligarBotoes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Religa botões adicionados dinamicamente após o carregamento inicial.
  window.wapptrackRefresh = ligarBotoes;
})();
