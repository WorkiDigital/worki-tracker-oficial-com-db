const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'js', 'app.js'), 'utf-8');

const modules = [
    { name: 'state.js',      startMarker: '// ── State',                 endMarker: '// ── Utils' },
    { name: 'utils.js',      startMarker: '// ── Utils',                 endMarker: '// ── Init' },
    { name: 'init.js',       startMarker: '// ── Init',                  endMarker: '// ── Seletor de cliente' },
    { name: 'admin.js',      startMarker: '// ── Seletor de cliente',    endMarker: '// ── Leads' },
    { name: 'leads.js',      startMarker: '// ── Leads',                 endMarker: '// ── Filtros' },
    { name: 'filters.js',    startMarker: '// ── Filtros',               endMarker: '// ── Render tabela' },
    { name: 'table.js',      startMarker: '// ── Render tabela',         endMarker: '// ── Export CSV' },
    { name: 'export.js',     startMarker: '// ── Export CSV',            endMarker: '// ── Relatórios' },
    { name: 'reports.js',    startMarker: '// ── Relatórios',            endMarker: '// ── Modal CAPI' },
    { name: 'capi.js',       startMarker: '// ── Modal CAPI',            endMarker: '// ── Anúncios — Account picker' },
    { name: 'ads-account.js',startMarker: '// ── Anúncios — Account p',  endMarker: '// ── Share Links' },
    { name: 'share.js',      startMarker: '// ── Share Links',           endMarker: '// ── Configuração de métricas' },
    { name: 'metrics-cfg.js',startMarker: '// ── Configuração de m',     endMarker: '// ── Configuração demográficos' },
    { name: 'demo-cfg.js',   startMarker: '// ── Configuração d',        endMarker: '// ── Funil de Conversão' },
    { name: 'funnel.js',     startMarker: '// ── Funil de Conversão',    endMarker: '// ── Demográficos' },
    { name: 'demo.js',       startMarker: '// ── Demográficos',          endMarker: '// ── Foco hierárquico' },
    { name: 'focus.js',      startMarker: '// ── Foco hierárquico',      endMarker: '// ── Expand hierárquico' },
    { name: 'expand.js',     startMarker: '// ── Expand hierárquico',    endMarker: '// ── Melhores Anúncios' }, // the first Melhores Anuncios
    { name: 'ads.js',        startMarker: '// ── Melhores Anúncios',     endMarker: '// ── Ad Media Modal' }, // actually there are two Melhores Anuncios, checking...
];

// Let's just split by '// ── ' generically
const blocks = src.split(/\/\/\s*──\s*/);

blocks.forEach(block => {
    if (!block.trim()) return;
    const lines = block.split('\n');
    const header = lines[0].replace(/─/g, '').trim();
    const content = lines.slice(1).join('\n').trim();
    
    // convert header to valid filename
    const filename = header.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.js';
    console.log(`Extracted: ${filename} (${content.length} bytes)`);
    fs.writeFileSync(path.join(__dirname, 'js', filename), '// ── ' + header + ' ──\n' + content, 'utf-8');
});

// Rename JS files according to plan
console.log('Done splitting!');
