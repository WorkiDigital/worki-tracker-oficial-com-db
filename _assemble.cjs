const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, 'js');

function load(name) {
    try {
        return fs.readFileSync(path.join(jsDir, name), 'utf-8');
    } catch(e) {
        return '';
    }
}

// 1. Group the chunks into our final target files
const targetFiles = {
    'state.js': ['state.js'],
    'utils.js': ['utils.js'],
    'auth.js': ['init.js'],
    'leads.js': [
        'leads.js', 
        'filtros.js', 
        'sorting.js', 
        'render-tabela-com-pagina-o.js', 
        'export-csv.js',
        'modal-capi.js'
    ],
    'reports.js': ['relat-rios.js'],
    'ads.js': [
        'an-ncios-account-picker.js', 
        'ad-media-modal.js',
        // 'melhores-an-ncios.js', (has two definitions, we'll pick the right ones)
    ],
    // ad-best and ads-demo logic
    'ads-best.js': [], // will handle manually below
    'ads-demo.js': [
        'configura-o-de-m-tricas.js',
        'configura-o-demogr-ficos.js',
        'funil-de-convers-o.js',
        'demogr-ficos.js',
        'foco-hier-rquico-clique-no-nome-para-filtrar-.js',
        'expand-hier-rquico-campanhas-conjuntos-an-ncios-.js'
    ],
    'share.js': [
        'share-links.js',
        'modo-edi-o-atualiza-token-existente.js',
        'modo-cria-o-gera-novo-token.js'
    ],
    'clients.js': [
        'admin-clientes-ag-ncias-saas-.js'
    ],
    'sidebar.js': [
        'sidebar-mobile.js',
        'sidebar-desktop.js',
        'abas.js'
    ],
    'app.js': [
        'theme.js',
        'start.js',
        'logs-do-sistema.js'
    ]
};

// Because we had duplicate names in the splitter (`melhores-an-ncios.js` x2)
// the second one actually contains 'Melhores Anuncios' loading logic.
// We will simply read all files in the directory and find them.
const allFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js') && f !== 'app.js');

let melhoresAdsFiles = allFiles.filter(f => f.startsWith('melhores-an'));
targetFiles['ads-best.js'] = melhoresAdsFiles;

// Write output
for (let target in targetFiles) {
    let content = '';
    targetFiles[target].forEach(f => {
        content += load(f) + '\n\n';
    });
    fs.writeFileSync(path.join(jsDir, target), content, 'utf-8');
    console.log('✅ Created ' + target);
}

// 2. Clear out the raw chunk files
allFiles.forEach(f => {
    // don't delete if it's one of the target files or in components folder
    if (!targetFiles[f] && f !== 'components' && !targetFiles[f.replace('-','') ]) {
       try { fs.unlinkSync(path.join(jsDir, f)); } catch(e){}
    }
});

// 3. Update index.html to inject all scripts statically
const HTML_PATH = path.join(__dirname, 'index.html');
let html = fs.readFileSync(HTML_PATH, 'utf-8');

const scripts = Object.keys(targetFiles).map(file => `<script src="/js/${file}"></script>`).join('\n    ');

// Replace the <script type="module" src="/js/app.js"></script> with the list of scripts
html = html.replace(/<script type="module" src="\/js\/app\.js"><\/script>/g, scripts + '\n    <script type="module" src="./js/components/whatsapp.js"></script>');

fs.writeFileSync(HTML_PATH, html, 'utf-8');
console.log('✅ index.html updated!');
