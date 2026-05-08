const fs = require('fs');

let f1 = 'api/webhook-n8n.js';
let c1 = fs.readFileSync(f1, 'utf8');
c1 = c1.replace(
  /\/\/ if \(evento !== 'purchase' && !ctw_aci_id\) \{ \.\.\. \} \/\/ Comentado para permitir Instagram Flows orgânicos\);\s*\}/,
  `// if (evento !== 'purchase' && !ctw_aci_id) { ... } // Comentado para permitir Instagram Flows orgânicos`
);
fs.writeFileSync(f1, c1);

let f2 = 'api/webhook-evo.js';
let c2 = fs.readFileSync(f2, 'utf8');
c2 = c2.replace(
  /\/\/ if \(!remoteJid\.endsWith\('@s\.whatsapp\.net'\)\) \{ \.\.\. \} \/\/ Comentado para Instagram Flows\);\s*\}/,
  `// if (!remoteJid.endsWith('@s.whatsapp.net')) { ... } // Comentado para Instagram Flows`
);
c2 = c2.replace(
  /\/\/ if \(!ctwaClid\) \{ \.\.\. \} \/\/ Comentado para Instagram Flows\);\s*\}/,
  `// if (!ctwaClid) { ... } // Comentado para Instagram Flows`
);
fs.writeFileSync(f2, c2);

console.log('Fixed syntax errors!');
