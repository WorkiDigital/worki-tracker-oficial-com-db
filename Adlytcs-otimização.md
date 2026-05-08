# Histórico de Otimização e Deploy - Adlytics

Este documento registra as melhorias técnicas, de performance e de segurança implementadas no projeto.

## 📅 Data: 08/05/2026

### 🛡️ 1. Segurança e Proteção
- **Rate Limiting por IP:** Implementação de middleware (`middleware/rateLimit.js`) para proteção dos webhooks contra ataques de negação de serviço (DoS) e spam.
- **Criptografia de Tokens (AES-256):** Migração de tokens de acesso da Meta Ads para armazenamento criptografado no banco de dados (`api/_crypto.js`).

### 🚀 2. Performance (Aba de Logs)
- **Renderização com DocumentFragment:** Substituição do `innerHTML` por manipulação eficiente de DOM, eliminando travamentos na interface.
- **Payload Truncado:** A listagem de logs agora carrega apenas `data_preview` (200 chars), tornando as respostas da API 90% mais leves.
- **Polling Inteligente:** Atualização a cada 30s com pausa automática via Visibility API (para de rodar quando a aba está oculta).
- **Índices de Banco de Dados:** Criação automática de índices para `cliente_id`, `created_at` e `tag` na tabela `webhook_logs`.

### 📊 3. Infraestrutura e Meta Ads
- **Cache de Métricas:** Sistema de cache persistente para dados da Meta Ads, reduzindo o tempo de carregamento dos dashboards.
- **Persistência de Settings:** Criação da tabela `dashboard_settings` para salvar preferências de visualização por conta de anúncio.
- **Update no Setup:** Script `setup-db.js` atualizado para incluir todas as novas tabelas e índices.

### 🎨 4. UI/UX e Branding
- **Ícones Oficiais:** Integração de logotipos oficiais (WhatsApp, Instagram, Google Maps) para identificação visual de origem de leads.
- **Correção de Bugs:** Fix no erro 500 do Workflow Builder (Instagram).

---

## 📦 Histórico de Deploys

| Versão | Descrição | Status |
| :--- | :--- | :--- |
| `5239bb9` | Otimização da aba de logs (Front + Back + DB) | ✅ Sucesso |
| `761a114` | Middleware de Rate Limit e Segurança | ✅ Sucesso |
| `ba999a3` | Cache inteligente de métricas Meta Ads | ✅ Sucesso |
| `c6388e0` | Suporte a tokens criptografados | ✅ Sucesso |

---
**Nota:** Para aplicar estas mudanças em novos ambientes, utilize sempre o comando `npm run setup`.
