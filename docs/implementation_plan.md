# Plano de Expansão: Evolution NATIVA & Blindagem de Tokens

Fiz a leitura das suas observações. Entendi 100% o que aconteceu e a grandeza do que você quer alcançar (virar quase um mini-ManyChat / CRM para seus clientes). 

## 1. O Problema do Vazamento do Token (Security Fix)
O painel do Facebook Ads (`api/ads.js` e etc) ainda estava buscando o Token Meta da variável global `.env`. Como o "Cliente" se logou, a API acidentalmente pegou o SEU TOKEN global e autorizou.
> **Ação Corretiva:** Vamos reescrever **todas** as 8 rotas de anúncios. Quando o Cliente B logar, a nossa API vai puxar no banco Postgres apenas o `token_meta` vinculado ao `cliente_id` dele de forma dinâmica e restrita. Fim do vazamento.

## 2. Abas de "Leads Reais" (Entenda como funciona)
O sistema já está **pronto** para envio manual via Dashboard. 
- Quando você criou um `Pixel` e deu um `Email/Senha` no Gestor de Clientes, ele loga e vê apenas a tabela de Leads dele. 
- Sem o N8N, ele pode clicar em **Status**, mudar para "Vendido" colocar o valor, e o nosso `leads-update.js` já está adaptado e faz o `POST` para a CAPI de forma manual. Não precisamos de nada novo aqui, só corrigir a tela.

## 3. Gestor Evolution NATIVO (O GRANDE UPGRADE)
A ideia de dar ao cliente o poder de ler o QR Code direto no app é fantástica e a consagração absoluta do nível SaaS.

**Como vai funcionar internamente:**
1. Aba `Conexões WhatsApp`.
2. O botão "Criar e Conectar".
3. Nossa API (`/api/evolution-instance.js`) vai fazer as chamadas ocultas para a sua Evolution API usando o Global API Key dela, e vai pedir pra Evolution gerar um QRCode.
4. O QR Code surge na tela do painel do próprio cliente e ele scaneia sozinho.
5. O Webhook interno da Evolution vai apontar diretamente para a nossa plataforma sem depender do N8N na fila!

> [!WARNING]
> Precisaremos adicionar suas chaves Globais da sua Evolution (Url do Servidor dela e a Global API KEY) no nosso painel.

## Proposed Changes

### [MODIFY] Rotas Meta Ads
Serão modificadas para matar a variável Global `process.env`. As rotas consultarão `$pool.query(SELECT token_meta FROM clientes WHERE id = cliente_id)`:
- `api/ads.js`
- `api/ads-accounts.js`
- `api/ads-best.js`
- `api/ads-children.js`
- `api/ads-demo.js`
- `api/ads-placement.js`
- `api/video-source.js`
- `api/ad-preview.js`

### [NEW] Módulo Evolution API 
- `api/evo-create.js` (Cria a instância com o nome do Cliente via API na Evolution.)
- `api/evo-qrcode.js` (Busca e exibe a imagem em Base64 do QrCode em tempo real pro painel)
- `api/evo-status.js` (Mostra se a mensagem está conectada ou caiu).

### [MODIFY] Frontend `index.html`
- Criação da Tab **Conexões WhatsApp**.
- Adicionar o Container de exibição do QR Code da Evolution API.
- Lógica via Javascript para ficar pulsando chamadas e verificando "Connected" após a leitura.

## User Review Required
> [!IMPORTANT]
> A aprovação deste plano reformulará as rotas Meta Ads do seu servidor permanentemente, garantindo isolamento total por Loja. Além disso, criaremos as rotas oficiais de QrCode nativo. 
Você autoriza a implantação Faseada (1º Arrumar Vazamento Token, 2º Implementar Aba Evolution)?
