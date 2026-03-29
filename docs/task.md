# Checklist de Execução: Saas Completo (Ads Security + Evolution)

## 🔒 Fase 1: Blindagem de Segurança (Tokens Isolados)
- `[x]` Refatorar `api/ads.js` (Ler token via Banco).
- `[x]` Refatorar `api/ads-accounts.js` (Ler token via Banco).
- `[x]` Refatorar `api/ads-best.js` (Ler token via Banco).
- `[x]` Refatorar `api/ads-children.js` (Ler token via Banco).
- `[x]` Refatorar `api/ads-demo.js` (Ler token via Banco).
- `[x]` Refatorar `api/ads-placement.js` (Ler token via Banco).
- `[x]` Refatorar `api/video-source.js` (Ler token via Banco).
- `[x]` Refatorar `api/ad-preview.js` (Ler token via Banco).

## 🟢 Fase 2: Evolution API Integrada no Adlytics
- `[x]` Configurar Variáveis da Evolution no Backend (`api/evo-manager.js`).
- `[x]` Criar Rota unificada `api/evo-manager.js` (Substitui create, qrcode e status).
- `[x]` Criar Frontend Aba *Conexões WhatsApp* no Painel.

## 🏁 Fase 3: Homologação
- `[ ]` Teste visual de Geração de Qr Code sem o N8N.
