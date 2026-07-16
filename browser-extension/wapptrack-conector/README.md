# WappTrack Conector — Session Transfer

Extensão Manifest V3 que transfere, com consentimento explícito, uma sessão já autenticada do WhatsApp Web para uma instância vazia do WappTrack/Evolution.

## Configuração

1. Em `config.js`, substitua `https://app.seudominio.com` pelo domínio HTTPS real.
2. Faça a mesma substituição em `host_permissions`, no `manifest.json`.
3. Configure no backend:
   - `WA_SESSION_TRANSFER_ENABLED=true`
   - `EVOLUTION_DATABASE_URL`
   - `SESSION_TRANSFER_ALLOWED_INSTANCES`
   - `EXTENSION_ORIGIN=chrome-extension://ID_DA_EXTENSAO`
   - `PAIRING_CODE_PEPPER` e `EXTENSION_JWT_SECRET`

## Fluxo

1. No WappTrack, escolha uma instância desconectada e gere o código temporário.
2. Abra `https://web.whatsapp.com`, faça login e conclua a Passkey, se solicitada.
3. Abra a extensão, informe o código e marque o consentimento.
4. A extensão prepara a sessão somente na memória e a envia ao backend fixo.
5. O backend valida número, código, cliente e instância, criptografa o payload e importa na Evolution.
6. A extensão aguarda o estado `CONNECTED`.
7. Se autorizado, a aba original é fechada somente depois da confirmação.
8. Em erro ou timeout, o backend restaura a sessão anterior da instância.

Não existe QR ou código de pareamento da Evolution nesse fluxo.

## Segurança

- A extração exige clique e consentimento visível do usuário.
- A extensão só roda em `web.whatsapp.com` e só envia ao domínio HTTPS fixado.
- Não baixa, copia ou persiste o JSON da sessão.
- O código é de uso único, expira e está vinculado à instância.
- O token da extensão tem duração curta e escopos exclusivos de Session Transfer.
- O payload fica criptografado no banco e é apagado após conexão, erro ou expiração.
- A aba de origem não é fechada antes da confirmação real da Evolution.
- Use apenas em números e instâncias sob controle do titular da conta.

## Instalação em modo desenvolvedor

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta que contém `manifest.json`.
5. Copie o ID da extensão e configure `EXTENSION_ORIGIN` no backend.

## Créditos

A rotina local de preparação da sessão deriva do projeto MIT `marcoscarraro/whatsapp-session-extractor`. Consulte `THIRD_PARTY_NOTICES.md`.
