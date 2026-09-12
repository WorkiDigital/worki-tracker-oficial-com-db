import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(path, 'utf8');
const html = read('index.html');
const dashboard = read('css/dashboard.css');
const base = read('css/dashboard-base.css');
const share = read('css/share.css');
const leads = read('js/leads.js');

assert.match(dashboard, /dashboard-base\.css\?v=20260912-fase5/);
assert.match(html, /css\/dashboard\.css\?v=20260912-fase5/);
assert.match(html, /js\/leads\.js\?v=20260912-fase5/);
assert.doesNotMatch(`${dashboard}\n${base}\n${share}`, /@media\s*\([^)]*(?:430|720)px/);

for (const source of [base, share]) {
  for (const [token, value] of Object.entries({
    '--bp-sm': '480px', '--bp-md': '768px', '--bp-lg': '960px', '--bp-xl': '1180px',
    '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px',
    '--space-5': '20px', '--space-6': '24px', '--space-8': '32px',
  })) assert.match(source, new RegExp(`${token}:\\s*${value.replace('.', '\\.')}\\b`));
}

for (const id of ['sep-atendimento', 'sep-campanhas', 'sep-metricas', 'sep-config', 'sep-admin']) {
  assert.match(html, new RegExp(`class="nav-sep" id="${id}"`));
}
assert.match(html, /if \(\$\('sep-admin'\)\) \$\('sep-admin'\)\.style\.display = 'block'/);
assert.match(html, /checkSep\('sep-metricas', \[[^\]]*'btn-clientes'/);

assert.doesNotMatch(html, />Link de rastreamento</);
assert.doesNotMatch(html, />Rastreamento inteligente</);
assert.doesNotMatch(html, />Conexões WhatsApp</);
assert.match(html, /ajustes:\s*'[^']*Marca \(White-label\)'/);

for (const icon of ['clock', 'zap', 'alert-triangle', 'trending-up', 'activity', 'image']) {
  assert.match(html, new RegExp(`data-lucide="${icon}"`));
}

for (const [file, source] of [['index.html', html], ['js/leads.js', leads]]) {
  for (const match of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attributes = match[1];
    const visibleText = match[2]
      .replace(/<[^>]*>/g, '')
      .replace(/&(?:\w+|#\d+);/g, '')
      .trim();
    if (!visibleText) {
      assert.match(
        attributes,
        /\baria-label\s*=/,
        `${file}: botão apenas com ícone sem aria-label: ${attributes.trim()}`,
      );
    }
  }
}

console.log('Fase 5 UX/UI: auditoria aprovada.');