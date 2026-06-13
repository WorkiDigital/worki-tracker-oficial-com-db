# Adlytics — WhatsApp Tracking + Meta Ads Dashboard (SaaS Multi-Tenant)

Sistema SaaS de rastreamento de leads via WhatsApp com envio automático de eventos para a Meta CAPI (Conversions API), dashboard de anúncios Meta Ads e painel de compartilhamento público. Cada cliente tem seu próprio pixel, instâncias WhatsApp e template de venda.

---

## Índice

1. [Como funciona](#como-funciona)
2. [Pré-requisitos](#pré-requisitos)
3. [Instalação local (desenvolvimento)](#instalação-local-desenvolvimento)
4. [Deploy em produção (EasyPanel)](#deploy-em-produção-easypanel)
5. [Variáveis de ambiente](#variáveis-de-ambiente)
6. [Criar as tabelas no banco](#criar-as-tabelas-no-banco)
7. [Criar o usuário admin](#criar-o-usuário-admin)
8. [Estrutura multi-tenant](#estrutura-multi-tenant)
9. [Adicionar clientes](#adicionar-clientes)
10. [Configurar template de venda](#configurar-template-de-venda)
11. [Conectar WhatsApp](#conectar-whatsapp)
12. [Dashboard compartilhado](#dashboard-compartilhado)
13. [Banco de dados](#banco-de-dados)
14. [Endpoints da API](#endpoints-da-api)
15. [Estrutura de arquivos](#estrutura-de-arquivos)
16. [Segurança](#segurança)
17. [Solução de problemas](#solução-de-problemas)

---

## Como funciona

```
Lead clica no anúncio → abre WhatsApp → Evolution API recebe
  → POST /api/webhook-evo
  → identifica cliente pelo nome da instância
  → salva lead no banco + envia LeadSubmitted para Meta CAPI

Atendente envia mensagem de venda (conforme template configurado)
  → webhook detecta valor > 0
  → atualiza lead para "Vendido"
  → envia Purchase para Meta CAPI com nome, telefone, cidade, produto, email, CPF
```

---

## Pré-requisitos

| Serviço | Versão/Tipo | Função |
|---------|-------------|--------|
| **Node.js** | 18+ (recomendado 20 LTS) | Runtime do backend |
| **PostgreSQL** | 14+ | Banco de dados relacional |
| **Redis** | 6+ | Cache de API e rate limiting (opcional em dev) |
| **Evolution API** | v2+ | Gerenciamento de instâncias WhatsApp (Baileys) |
| **Meta Business** | — | Pixel + Token de acesso permanente para CAPI e Ads |
| **Git** | — | Clone do repositório |

---

## Instalação local (desenvolvimento)

### 1. Clonar o repositório

```bash
git clone https://github.com/WorkiDigital/worki-tracker-oficial-com-db.git
cd worki-tracker-oficial-com-db
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais (veja [Variáveis de ambiente](#variáveis-de-ambiente)).

### 4. Criar as tabelas no banco

```bash
npm run setup
```

Ou diretamente:

```bash
node setup-db.js
```

> É seguro rodar múltiplas vezes — usa `IF NOT EXISTS` e `ADD COLUMN IF NOT EXISTS`.

### 5. Criar o usuário admin

```bash
node -e "
import('dotenv/config').then(async () => {
  const { default: bcrypt } = await import('bcryptjs');
  const { default: pkg } = await import('pg');
  const pool = new pkg.Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await bcrypt.hash('SuaSenhaForte123', 10);
  await pool.query(\"INSERT INTO usuarios (email, senha_hash, is_admin) VALUES ('admin@suaagencia.com', \$1, true)\", [hash]);
  console.log('Admin criado!');
  await pool.end();
});
"
```

> Substitua `admin@suaagencia.com` e `SuaSenhaForte123` pelos seus valores.

### 6. Iniciar o servidor

```bash
npm start
```

Acesse: **http://localhost:3000**

O servidor serve automaticamente:
- `login.html` — tela de login
- `index.html` — dashboard principal (admin + cliente)
- `share.html` — dashboard público compartilhado
- `/api/*` — endpoints da API
- `/health` — health check básico
- `/health/detailed` — health check com status do DB e Redis

---

## Deploy em produção (EasyPanel)

### 1. Criar o serviço

1. EasyPanel → **New Service** → **App**
2. Conectar ao repositório GitHub: `WorkiDigital/worki-tracker-oficial-com-db`
3. Branch: `main`
4. O **Nixpacks** detecta automaticamente o build:
   - Build: `npm install --omit=dev`
   - Start: `node server.js`

### 2. Serviços auxiliares

No EasyPanel, crie também:

- **PostgreSQL** → anote a `DATABASE_URL` gerada
- **Redis** → anote a `REDIS_URL` gerada

### 3. Variáveis de ambiente

Adicionar em **Environment** do serviço (veja detalhes na [seção abaixo](#variáveis-de-ambiente)).

### 4. Health check

Configure no EasyPanel:
- Path: `/health`
- Porta: `3000`
- Intervalo: 30s

### 5. Domínio

1. EasyPanel → **Domains** → adicionar `app.seudominio.com`
2. Apontar DNS (CNAME ou A) para o IP do servidor
3. SSL será gerado automaticamente (Let's Encrypt)

### 6. Após o deploy

1. Abrir o terminal do serviço (EasyPanel → Terminal)
2. Rodar `node setup-db.js` para criar as tabelas
3. Criar o admin conforme [seção acima](#criar-o-usuário-admin)

---

## Variáveis de ambiente

| Variável | Obrigatória | Exemplo | Descrição |
|----------|:-----------:|---------|-----------|
| `DATABASE_URL` | ✅ | `postgresql://user:pass@host:5432/db` | String de conexão PostgreSQL |
| `JWT_SECRET` | ✅ | `minimo-32-caracteres-aleatorios` | Segredo para assinar tokens JWT. **Nunca deixe em branco em produção** |
| `META_ADS_TOKEN` | ✅ | `EAAI...` | Token de acesso permanente da Meta (Graph API) |
| `REDIS_URL` | ⬜ | `redis://redis:6379` | URL do Redis para cache e rate limiting. Se ausente, cache fica em memória |
| `ALLOWED_ORIGINS` | ⬜ | `https://app.seudominio.com` | Origens CORS permitidas (separar por vírgula). Default: `*` |
| `EVOLUTION_API_URL` | ⬜ | `https://evo.seudominio.com` | URL base da Evolution API |
| `EVOLUTION_GLOBAL_KEY` | ⬜ | `chave_global` | Chave de autenticação global da Evolution API |
| `WEBHOOK_SECRET` | ⬜ | `segredo_para_webhooks` | Segredo para validar webhooks da Evolution |
| `RATE_LIMIT_RPM` | ⬜ | `120` | Requisições por minuto por usuário (default: 120) |
| `LOG_LEVEL` | ⬜ | `info` | Nível de log: `debug`, `info`, `warn`, `error` (default: `info`) |
| `PORT` | ⬜ | `3000` | Porta do servidor (default: 3000) |

> ⬜ = opcional em desenvolvimento, mas recomendado em produção.

---

## Criar as tabelas no banco

```bash
node setup-db.js
```

Este script cria/migra todas as tabelas:

| Tabela | Descrição |
|--------|-----------|
| `usuarios` | Logins com e-mail + senha hash (admin e clientes) |
| `clientes` | Dados de cada cliente (pixel, token, template de venda) |
| `leads_tracking` | Todos os leads com campos de venda (nome, tel, valor, produto, etc.) |
| `instancias_mapeamento` | Instâncias WhatsApp externas vinculadas a clientes |
| `share_tokens` | Tokens de compartilhamento de dashboard público |
| `webhook_logs` | Logs de todos os webhooks recebidos |

> Rode sempre que atualizar o sistema — novas colunas são adicionadas automaticamente com `ADD COLUMN IF NOT EXISTS`.

---

## Criar o usuário admin

O primeiro acesso requer um admin criado diretamente no banco:

```bash
node -e "
import('dotenv/config').then(async () => {
  const { default: bcrypt } = await import('bcryptjs');
  const { default: pkg } = await import('pg');
  const pool = new pkg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  const hash = await bcrypt.hash('SuaSenhaForte123', 10);
  await pool.query(\"INSERT INTO usuarios (email, senha_hash, is_admin) VALUES ('admin@suaagencia.com', \$1, true)\", [hash]);
  console.log('Admin criado!');
  await pool.end();
});
"
```

Depois acesse `http://localhost:3000` (ou seu domínio) e faça login com o e-mail e senha definidos.

---

## Estrutura Multi-tenant

```
Agência (admin, is_admin=true)
  └── Cliente A (cliente_id=1) → pixel: 111111111
  └── Cliente B (cliente_id=2) → pixel: 222222222
  └── Cliente C (cliente_id=3) → pixel: 333333333
```

- **Token Meta:** único da agência (`META_ADS_TOKEN`), com acesso a todos os pixels dos clientes
- **Pixel:** cada cliente tem o seu próprio (`clientes.pixel_padrao`)
- **Token por cliente:** se `clientes.token_meta` estiver preenchido, usa ele; caso contrário usa o da agência
- **Instâncias Evolution:** prefixadas automaticamente
  - Admin: `admin_nome`
  - Cliente: `cliente_{id}_nome`
  - Instâncias externas vinculadas via `instancias_mapeamento`

---

## Adicionar clientes

1. Logar como admin
2. Menu **Agência** → **+ Novo Cliente**
3. Preencher: Nome, Pixel Meta, E-mail, Senha
4. Sistema cria o cliente + usuário de acesso automaticamente
5. Compartilhar login com o cliente

---

## Configurar template de venda

Cada cliente define o formato exato da mensagem que o atendente envia para registrar uma venda.

1. Menu **Agência** → **Editar** cliente → aba **Venda**
2. Colar o template com as variáveis no formato `Label: {campo}`:

```
Parabéns pela sua compra!
Nome: {nome}
Produto: {produto}
Valor da Compra: {valor}
Endereço: {endereco}
Cidade: {cidade}
E-mail: {email}
CPF: {cpf}
```

3. Clicar em **Salvar Alterações**

### Campos suportados

| Variável | Enviado à Meta CAPI | Campo no banco |
|----------|---------------------|----------------|
| `{valor}` | `custom_data.value` | `valor_venda` |
| `{nome}` | `fn` + `ln` (hash SHA-256) | `nome` |
| `{cidade}` | `ct` (hash SHA-256) | `cidade` |
| `{produto}` | `content_name` | `produto` |
| `{email}` | `em` (hash SHA-256) | `email` |
| `{cpf}` | `external_id` (hash SHA-256) | `cpf` |
| `{endereco}` | — | `endereco` |
| `{cor}` | — | `cor` |
| `{pagamento}` | — | `forma_pagamento` |

> Campos ausentes na mensagem são ignorados — os outros são enviados normalmente.

### Como o atendente usa

O atendente copia o template (sem as variáveis), preenche e envia no WhatsApp:

```
Parabéns pela sua compra!
Nome: Herickson Maia
Produto: Cama Queen
Valor da Compra: 2.000
Endereço: Rua 31 de janeiro N 620
Cidade: Fortaleza - CE
```

> `Cidade: Fortaleza - CE` → o sistema separa automaticamente cidade e estado.

---

## Conectar WhatsApp

### Opção 1 — Nova instância (cliente cria a própria)

1. Logar como cliente (ou admin)
2. Menu **Conexão WhatsApp** → **+ Nova Conexão**
3. Digitar nome da instância (ex: `Loja Principal`)
4. Sistema cria a instância na Evolution e configura o webhook automaticamente
5. Escanear QR Code

### Opção 2 — Vincular instância existente (só admin)

1. Logar como admin
2. Menu **Conexão WhatsApp** → **Conectar Existente**
3. Selecionar a instância e o cliente
4. Sistema vincula e configura o webhook

---

## Dashboard compartilhado

Admins podem gerar links públicos para clientes visualizarem métricas sem login:

1. Menu **Links de Compartilhamento** → **Criar Link**
2. Selecionar a conta de anúncios e configurar:
   - Métricas visíveis (gasto, impressões, leads, conversas, etc.)
   - Seções visíveis (campanhas, demográficos, funil, criativos)
   - Colunas da tabela de campanhas
   - Filtro de status padrão
3. Copiar o link gerado: `https://seudominio.com/share.html?token=abc123`
4. O link mostra o dashboard de anúncios sem necessidade de login

---

## Banco de dados

### Tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `usuarios` | Logins (admin + clientes). Campo `is_admin` define o papel |
| `clientes` | Pixel, token Meta, template de venda, conta de anúncios |
| `leads_tracking` | Leads com todos os campos de venda |
| `instancias_mapeamento` | Instâncias Evolution vinculadas a clientes |
| `share_tokens` | Tokens e configuração de dashboards públicos |
| `webhook_logs` | Logs de todos os webhooks recebidos |

### Colunas principais de `leads_tracking`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `cliente_id` | INTEGER | Vínculo multi-tenant |
| `status` | VARCHAR | `Lead`, `Vendido`, `Pendente` |
| `nome` / `telefone` | VARCHAR | Dados do lead |
| `valor_venda` | NUMERIC | Valor da compra |
| `produto` | VARCHAR | Produto vendido |
| `endereco` | TEXT | Endereço do cliente |
| `cidade` / `estado` | VARCHAR | Localização (separados automaticamente) |
| `email` | VARCHAR | E-mail do cliente |
| `cpf` | VARCHAR | CPF do cliente |
| `cor` | VARCHAR | Cor/variação do produto |
| `forma_pagamento` | VARCHAR | Forma de pagamento |
| `ctw_aci_id` | TEXT | Click ID do anúncio |
| `utm_campaign` / `utm_medium` / `utm_content` | VARCHAR | UTMs extraídos da Meta API |

---

## Endpoints da API

### Autenticação

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth-login` | Login com e-mail e senha → retorna JWT |
| POST | `/api/auth-register` | Registro de novo usuário (admin only) |

### Leads

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/leads` | Lista leads do cliente com filtros e paginação |
| PUT | `/api/leads-update` | Atualiza status/dados de um lead |

### Meta Ads

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/ads` | Campanhas e métricas da conta de anúncios |
| GET | `/api/ads-accounts` | Lista contas de anúncios disponíveis |
| GET | `/api/ads-best` | Melhores criativos ordenados por métrica |
| GET | `/api/ads-children` | Adsets e ads de uma campanha |
| GET | `/api/ads-demo` | Dados demográficos (idade, gênero, plataforma) |
| GET | `/api/ads-placement` | Dados por posicionamento |
| GET | `/api/ad-preview` | Preview oficial de um anúncio (iframe Meta) |
| GET | `/api/video-source` | Fonte HD de um vídeo de criativo |

### Clientes (admin)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST/PUT/DELETE | `/api/clientes` | CRUD completo de clientes |
| GET/PUT | `/api/config` | Configuração de métricas e seções do dashboard |

### WhatsApp / Evolution

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST/DELETE | `/api/evo-manager` | Gerenciamento de instâncias WhatsApp |
| POST | `/api/webhook-evo` | Webhook da Evolution API (entrada de leads) |

### Compartilhamento

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/share-create` | Cria link de compartilhamento |
| GET | `/api/share-list` | Lista links criados |
| PUT | `/api/share-update` | Atualiza configuração de um link |
| GET | `/api/share-ads` | Dados de campanhas para dashboard público |
| GET | `/api/share-best` | Melhores criativos para dashboard público |
| GET | `/api/share-demo` | Demográficos para dashboard público |
| GET | `/api/share-placement` | Posicionamento para dashboard público |
| GET | `/api/share-preview` | Preview de anúncio para dashboard público |
| GET | `/api/share-video` | Fonte de vídeo para dashboard público |

### Logs e sistema

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/logs` | Logs de webhook (admin) |
| GET | `/health` | Health check básico (`{ status: 'ok' }`) |
| GET | `/health/detailed` | Health check com status do DB e Redis |

---

## Estrutura de arquivos

```
/
├── server.js              # Entry point — roteador HTTP, serve estáticos e /api/*
├── setup-db.js            # Cria/migra todas as tabelas (idempotente)
├── reset-db.js            # Reset de tabelas (CUIDADO: apaga dados)
├── package.json           # Dependências e scripts (start, dev, setup)
├── nixpacks.toml          # Config de build para EasyPanel/Nixpacks
├── vercel.json            # Rewrites para deploy na Vercel (alternativo)
├── .env.example           # Template de variáveis de ambiente
│
├── index.html             # Dashboard principal (admin + cliente)
├── login.html             # Tela de login
├── share.html             # Dashboard público compartilhado
│
├── css/
│   ├── dashboard.css      # Estilos do dashboard principal
│   ├── share.css          # Estilos do dashboard compartilhado
│   └── login.css          # Estilos da tela de login
│
├── js/
│   ├── utils.js           # Utilitários compartilhados ($, esc, ls, getAct)
│   ├── leads.js           # Módulo de leads (tabela, filtros, CSV, relatórios)
│   ├── admin.js           # Módulo admin (CRUD clientes, WhatsApp, logs)
│   └── share-dash.js      # Lógica completa do dashboard compartilhado
│
├── api/
│   ├── _auth.js           # Middleware de verificação JWT
│   ├── _cache.js          # Cache isolado por usuário (Redis ou memória)
│   ├── _cors.js           # Middleware CORS
│   ├── _db.js             # Pool PostgreSQL
│   ├── _logger.js         # Logger estruturado com níveis
│   ├── _meta-client.js    # Cliente Meta Graph API com retry
│   ├── _rate-limit.js     # Rate limiting por IP/usuário
│   ├── _validate.js       # Validações de segurança (IDOR)
│   │
│   ├── auth-login.js      # POST /api/auth-login
│   ├── auth-register.js   # POST /api/auth-register
│   ├── clientes.js        # CRUD de clientes (admin)
│   ├── config.js          # Config de métricas/seções do dashboard
│   ├── leads.js           # GET leads do cliente
│   ├── leads-update.js    # PUT leads
│   ├── logs.js            # GET logs do webhook
│   │
│   ├── ads.js             # Meta Ads — campanhas e métricas
│   ├── ads-accounts.js    # Meta Ads — contas disponíveis
│   ├── ads-best.js        # Meta Ads — melhores criativos
│   ├── ads-children.js    # Meta Ads — adsets e ads
│   ├── ads-demo.js        # Meta Ads — dados demográficos
│   ├── ads-placement.js   # Meta Ads — posicionamento
│   ├── ad-preview.js      # Meta Ads — preview oficial
│   ├── video-source.js    # Meta Ads — fonte HD de vídeo
│   │
│   ├── evo-manager.js     # Gerenciamento de instâncias WhatsApp
│   ├── webhook-evo.js     # Webhook Evolution → Lead/Purchase
│   │
│   ├── share-ads.js       # Dashboard público — campanhas
│   ├── share-best.js      # Dashboard público — criativos
│   ├── share-create.js    # Dashboard público — criar link
│   ├── share-demo.js      # Dashboard público — demográficos
│   ├── share-list.js      # Dashboard público — listar links
│   ├── share-placement.js # Dashboard público — posicionamento
│   ├── share-preview.js   # Dashboard público — preview
│   ├── share-update.js    # Dashboard público — atualizar config
│   └── share-video.js     # Dashboard público — vídeo
│
└── docs/                  # Documentação adicional
    ├── documentacao_saas.md
    ├── app_dinamica.md
    ├── implementation_plan.md
    ├── task.md
    └── walkthrough.md
```

---

## Segurança

| Recurso | Implementação |
|---------|---------------|
| **Autenticação** | JWT com `JWT_SECRET` obrigatório (alerta crítico se ausente) |
| **Rate limiting** | Por IP no login (10 tentativas/15min), por usuário na API geral |
| **CORS** | Origens permitidas configuráveis via `ALLOWED_ORIGINS` |
| **Webhooks** | Validação de `WEBHOOK_SECRET` nos webhooks Evolution |
| **IDOR** | `verifyAccountAccess()` valida posse do `account_id` em toda requisição |
| **Cache** | Isolado por usuário (`userCacheKey()`) — um usuário nunca vê dados de outro |
| **Token Meta** | Nunca exposto no HTML — armazenado no servidor |
| **XSS** | Função `esc()` sanitiza todo conteúdo em `innerHTML` |
| **SQL Injection** | Queries parametrizadas em todos os endpoints |
| **Retry** | Meta Graph API com retry automático em erros 5xx e rate limits |

---

## Solução de problemas

### O servidor não inicia

```
❌ ERRO: DATABASE_URL não foi definida
```

Certifique-se de que o `.env` existe e contém `DATABASE_URL`. Em produção, configure nas variáveis de ambiente do EasyPanel.

### Erro de conexão com banco

```
Error: connect ECONNREFUSED
```

Verifique se o PostgreSQL está rodando e se a `DATABASE_URL` está correta. Em produção com SSL, o sistema usa `ssl: { rejectUnauthorized: false }` automaticamente.

### Token Meta inválido

```
Error validating access token
```

O `META_ADS_TOKEN` expirou. Gere um novo token permanente no [Meta Business](https://business.facebook.com/settings/system-users) → System Users → Generate Token com permissões: `ads_read`, `ads_management`, `pages_read_engagement`.

### Redis não conecta (não crítico)

Se `REDIS_URL` não estiver definido ou o Redis estiver offline, o sistema funciona normalmente usando cache em memória. Logs indicarão:

```
[WARN] Redis connection failed, falling back to in-memory cache
```

### Webhook não recebe leads

1. Verifique se a instância WhatsApp está conectada (QR escaneado)
2. Verifique se o webhook está configurado na Evolution API
3. Confira os logs em **Sistema → Logs** no painel admin
4. Se `WEBHOOK_SECRET` estiver definido, a Evolution deve enviar o mesmo secret

### Health check falha no EasyPanel

Verifique se o health check está apontando para:
- Path: `/health`
- Porta: `3000` (ou a porta configurada)

Teste manualmente: `curl http://localhost:3000/health`

---

## Scripts disponíveis

| Comando | Descrição |
|---------|-----------|
| `npm start` | Inicia o servidor (`node server.js`) |
| `npm run dev` | Mesmo que `npm start` (sem hot-reload) |
| `npm run setup` | Cria/migra tabelas no banco (`node setup-db.js`) |
