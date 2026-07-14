# Deploy separado — Frontend + API + PostgreSQL + Redis

Esta branch separa a execução do Worki Tracker em dois serviços de aplicação, mantendo PostgreSQL e Redis atuais.

## Topologia final

```text
app.seudominio.com
└── Serviço frontend-only

api.seudominio.com
├── Serviço API-only
├── /api/*
├── /r/*
├── /redirect/*
├── /js/wapptrack.js
├── webhooks
└── crons

PostgreSQL atual
Redis atual
```

## Compatibilidade e rollback

O comando antigo foi preservado:

```bash
npm start
```

Ele continua executando `server.js`, que serve frontend e API juntos. Isso permite rollback imediato enquanto os dois serviços separados são validados.

## Serviço da API

### Comando de início

```bash
npm run start:api
```

### Domínio sugerido

```text
https://api.seudominio.com
```

### Variáveis necessárias

Mantenha as variáveis atuais do serviço principal, incluindo:

```text
DATABASE_URL
REDIS_URL
JWT_SECRET
TOKEN_ENCRYPTION_KEY
META_ADS_TOKEN
EVOLUTION_API_URL
EVOLUTION_GLOBAL_KEY
WEBHOOK_SECRET
CRON_SECRET
HEALTHCHECK_TOKEN
ENABLE_CRONS=true
NODE_ENV=production
PORT=3000
```

`ENABLE_CRONS` controla se este processo inicia os crons de relatórios e limpeza.
**Nunca deixe `ENABLE_CRONS=true` simultaneamente neste serviço e no legado
(`npm start`)** — os dois rodando ao mesmo tempo duplicam envio de relatórios e
execução de limpeza. Durante a migração, configure `ENABLE_CRONS=false` no
serviço legado (via env) enquanto ele continuar no ar como fallback.

Configure também o CORS:

```text
ALLOWED_ORIGINS=https://app.seudominio.com
```

Para staging e produção na mesma API:

```text
ALLOWED_ORIGINS=https://app.seudominio.com,https://app-staging.seudominio.com
```

### Health check

```text
/health
```

A resposta deve conter:

```json
{
  "status": "ok",
  "service": "api"
}
```

### Rotas que a API expõe

```text
/api/*
/r/*
/redirect/*
/js/wapptrack.js
/health
/healthz
/health/detailed
```

A raiz `/`, os HTMLs, CSS e JS do painel não são servidos por este processo.

## Serviço do frontend

### Comando de início

```bash
npm run start:static
```

### Domínio sugerido

```text
https://app.seudominio.com
```

### Variáveis necessárias

```text
API_BASE_URL=https://api.seudominio.com
NODE_ENV=production
PORT=3000
```

O frontend não precisa receber:

```text
DATABASE_URL
REDIS_URL
JWT_SECRET
TOKEN_ENCRYPTION_KEY
META_ADS_TOKEN
EVOLUTION_GLOBAL_KEY
```

### Health check

```text
/health
```

A resposta deve conter:

```json
{
  "status": "ok",
  "service": "frontend"
}
```

### Configuração em runtime

`index.html`, `login.html` e `share.html` carregam `<script src="/runtime-config.js">` no `<head>`, antes de `js/utils.js`. O `server-static.js` serve esse arquivo a partir da env `API_BASE_URL`:

```javascript
window.APP_CONFIG = Object.freeze({ API_BASE_URL: "https://api.seudominio.com" });
```

`apiUrl(path)` (em `js/utils.js` e na função local equivalente de `login.html`) lê `window.APP_CONFIG.API_BASE_URL`, com fallback para `window.API_BASE_URL` em HTML mais antigo. Assim, o mesmo código pode ser usado em staging e produção sem alterar os arquivos HTML — só a env `API_BASE_URL` muda.

O `server.js` legado e o `server-static.js` também servem `/runtime-config.js` (o legado sempre com `API_BASE_URL: ""`, já que roda frontend e API juntos na mesma origem). O endpoint expõe apenas a URL pública da API, sem segredos.

## EasyPanel — configuração recomendada

### Serviço `apptrack-api`

```text
Source: mesmo repositório
Branch: refactor/separate-frontend-api-services
Build: npm install --omit=dev
Start: npm run start:api
Port: 3000
Domain: api.seudominio.com
Health: /health
Env: ENABLE_CRONS=true
```

### Serviço `apptrack-front`

```text
Source: mesmo repositório
Branch: refactor/separate-frontend-api-services
Build: npm install --omit=dev
Start: npm run start:static
Port: 3000
Domain: app.seudominio.com
Health: /health
```

### PostgreSQL

Sem alteração.

### Redis

Sem alteração.

## Sequência segura de ativação

1. Faça deploy do serviço API com `npm run start:api` em um subdomínio de staging.
2. Confirme `/health` e `/health/detailed`.
3. Faça deploy do frontend com `API_BASE_URL` apontando para a API de staging.
4. Teste login, dashboard, leads, Kanban, relatórios, compartilhamentos, integrações e configurações.
5. Teste `/r/:slug`, `/redirect/:slug` e `/js/wapptrack.js` no domínio da API.
6. Configure `ALLOWED_ORIGINS` com o domínio real do frontend.
7. Publique os dois serviços em produção.
8. Mantenha temporariamente o serviço legado com `npm start` como fallback, configurando `ENABLE_CRONS=false` nele para não duplicar crons com o serviço `apptrack-api`.
9. Após validação, remova o domínio público do serviço legado ou desative-o.

## Checklist de validação

- [ ] Frontend abre sem `DATABASE_URL`.
- [ ] Frontend não responde `/api/*`.
- [ ] API não serve `index.html`.
- [ ] Login funciona entre domínios.
- [ ] Token `Authorization` chega à API.
- [ ] CORS aceita apenas o domínio do frontend.
- [ ] Leads carregam.
- [ ] Kanban funciona.
- [ ] Relatórios funcionam.
- [ ] Compartilhamento público funciona.
- [ ] Webhook da Evolution continua apontando para a API.
- [ ] `wapptrack.js` continua sendo carregado pelo domínio da API.
- [ ] Links `/r/` e `/redirect/` funcionam.
- [ ] PostgreSQL não foi alterado.
- [ ] Redis não foi alterado.
- [ ] Cron de relatórios está ativo apenas no serviço da API (`ENABLE_CRONS=true` só ali, `ENABLE_CRONS=false` no legado se ele continuar ativo).
- [ ] Cron de limpeza está ativo apenas no serviço da API.
- [ ] `/runtime-config.js` do frontend retorna a URL correta da API em produção.

## Rollback

Em caso de problema:

1. Reative o serviço legado com:

```bash
npm start
```

2. Aponte o domínio anterior para ele.
3. Não é necessário restaurar banco ou Redis, pois a separação não altera dados nem schema.
