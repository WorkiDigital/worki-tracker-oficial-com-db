/* ── Shared Utilities ─────────────────────────────────────────── */

const $ = id => document.getElementById(id);
const esc = s => !s ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function ls(k,v) { try { if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v); } catch(_){} }

// Meta API — soma de actions por action_type
function getAct(ins, keys) {
    if (!ins?.actions) return 0;
    const ks = new Set(Array.isArray(keys) ? keys : [keys]);
    return ins.actions
        .filter(a => ks.has(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value||0), 0);
}
