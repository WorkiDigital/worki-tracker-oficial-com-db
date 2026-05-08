const fs = require('fs');

let f1 = 'api/webhook-n8n.js';
let c1 = fs.readFileSync(f1, 'utf8');
c1 = c1.replace(
  /\/\/ if \(evento !== 'purchase' && !ctw_aci_id\) \{ \.\.\. \} \/\/ Comentado para permitir Instagram Flows orgânicos/,
  `if (evento !== 'purchase' && !ctw_aci_id) {\n    return res.status(200).json({ ignored: true, message: 'Contato sem ctwaClid — não veio de anúncio, ignorado.' });\n  }`
);
fs.writeFileSync(f1, c1);

let f2 = 'api/webhook-evo.js';
let c2 = fs.readFileSync(f2, 'utf8');
c2 = c2.replace(
  /\/\/ if \(!remoteJid\.endsWith\('@s\.whatsapp\.net'\)\) \{ \.\.\. \} \/\/ Comentado para Instagram Flows/,
  `if (!remoteJid.endsWith('@s.whatsapp.net')) {\n    if (!isStatus && !fromMe) log('filter', 'Ignorado: Não é chat individual', { remoteJid });\n    return res.status(200).json({ ignored: true, reason: 'not individual chat' });\n  }`
);
c2 = c2.replace(
  /\/\/ if \(!ctwaClid\) \{ \.\.\. \} \/\/ Comentado para Instagram Flows/,
  `if (!ctwaClid) {\n      log('filter', 'Ignorado: Lead sem ID de anúncio (ctwaClid)', { telefone });\n      return res.status(200).json({ ignored: true, reason: 'no ctwaClid' });\n    }`
);
fs.writeFileSync(f2, c2);

console.log('Webhooks reverted successfully!');
