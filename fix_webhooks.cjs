const fs = require('fs');

// Fix N8N
let f1 = 'api/webhook-n8n.js';
let c1 = fs.readFileSync(f1, 'utf8');
c1 = c1.replace(
  /if \(evento !== 'purchase' && !ctw_aci_id\) \{[\s\S]*?ignored: true[\s\S]*?\}/,
  `// if (evento !== 'purchase' && !ctw_aci_id) { ... } // Comentado para permitir Instagram Flows orgânicos`
);
fs.writeFileSync(f1, c1);

// Fix EVO
let f2 = 'api/webhook-evo.js';
let c2 = fs.readFileSync(f2, 'utf8');
c2 = c2.replace(
  /if \(!ctwaClid\) \{[\s\S]*?ignored: true, reason: 'no ctwaClid'[\s\S]*?\}/,
  `// if (!ctwaClid) { ... } // Comentado para Instagram Flows`
);
c2 = c2.replace(
  /if \(!remoteJid\.endsWith\('@s\.whatsapp\.net'\)\) \{[\s\S]*?ignored: true, reason: 'not individual chat'[\s\S]*?\}/,
  `// if (!remoteJid.endsWith('@s.whatsapp.net')) { ... } // Comentado para Instagram Flows`
);
fs.writeFileSync(f2, c2);

console.log('Webhooks fixed for Instagram Flows!');
