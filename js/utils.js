/* ── Shared Utilities ─────────────────────────────────────────── */

const $ = id => document.getElementById(id);
const esc = s => !s ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function sanitizeSvg(svgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const errorNode = doc.querySelector('parsererror');
    if (errorNode) return null;
    const svg = doc.documentElement;
    svg.querySelectorAll('script, foreignObject').forEach(el => el.remove());
    svg.querySelectorAll('*').forEach(el => {
        for (const attr of [...el.attributes]) {
            if (attr.name.startsWith('on') || (attr.name === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:'))) {
                el.removeAttribute(attr.name);
            }
        }
    });
    return svg;
}

function sanitizeImgUrl(url) {
    if (!url) return null;
    const trimmed = url.trim().toLowerCase();
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('data:image/')) return url.trim();
    return null;
}
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { } }

// Meta API — soma de actions por action_type
function getAct(ins, keys) {
    if (!ins?.actions) return 0;
    const ks = new Set(Array.isArray(keys) ? keys : [keys]);
    return ins.actions
        .filter(a => ks.has(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value || 0), 0);
}

// Meta API — soma de action_values por action_type (valor monetário)
function getActVal(ins, keys) {
    if (!ins?.action_values) return 0;
    const ks = new Set(Array.isArray(keys) ? keys : [keys]);
    return ins.action_values
        .filter(a => ks.has(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value || 0), 0);
}

// Meta API — pega o valor do PRIMEIRO action_type presente, na ordem de preferência (NÃO soma).
// Evita double-counting: a Meta retorna variantes (omni_purchase, purchase,
// offsite_conversion.fb_pixel_purchase...) que carregam o MESMO valor. omni_* é o roll-up
// deduplicado. Somar as variantes contaria a mesma compra 2-3 vezes.
function getActFirst(ins, keysOrdenadas) {
    if (!ins?.actions) return 0;
    for (const k of keysOrdenadas) {
        const a = ins.actions.find(x => x.action_type === k);
        if (a) return parseFloat(a.value || 0);
    }
    return 0;
}

// Idem para action_values (valor monetário).
function getActValFirst(ins, keysOrdenadas) {
    if (!ins?.action_values) return 0;
    for (const k of keysOrdenadas) {
        const a = ins.action_values.find(x => x.action_type === k);
        if (a) return parseFloat(a.value || 0);
    }
    return 0;
}

// Meta API — extrai o valor de um campo de vídeo (video_p25_watched_actions, etc.),
// que vem como array [{action_type:'video_view', value:'N'}]. Soma os values do array.
function getVideoVal(ins, campo) {
    const arr = ins?.[campo];
    if (!Array.isArray(arr)) return 0;
    return arr.reduce((s, a) => s + parseFloat(a.value || 0), 0);
}

// Meta API — ROAS de purchase_roas
function getRoas(ins) {
    if (!ins?.purchase_roas) return 0;
    const entry = ins.purchase_roas.find(r => r.action_type === 'omni_purchase');
    return parseFloat(entry?.value || 0);
}

// ── Cache in-memory com TTL ───────────────────────────────────
class MemCache {
    constructor(ttlMs = 5 * 60 * 1000) {
        this._ttl = ttlMs;
        this._store = new Map();
    }
    set(key, value) {
        this._store.set(key, { value, exp: Date.now() + this._ttl });
    }
    get(key) {
        const entry = this._store.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.exp) { this._store.delete(key); return undefined; }
        return entry.value;
    }
    has(key) { return this.get(key) !== undefined; }
    del(key) { this._store.delete(key); }
    clear() { this._store.clear(); }
}

// ── Dynamic script loader (singleton por URL) ─────────────────
const _loadedScripts = new Set();
function loadScript(url) {
    if (_loadedScripts.has(url)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload  = () => { _loadedScripts.add(url); resolve(); };
        s.onerror = () => reject(new Error(`Falha ao carregar script: ${url}`));
        document.head.appendChild(s);
    });
}
