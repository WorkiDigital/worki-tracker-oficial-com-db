# 🧠 Como Funciona a Dinâmica do App — Adlytics

## Visão Geral

O **Adlytics** (`whatsapp-traking-oficial`) é um **dashboard de rastreamento e análise de leads e anúncios** voltado para gestores de tráfego. Ele integra:
- **Supabase** → banco de dados e autenticação
- **Meta Ads API (Graph API)** → dados de campanhas do Facebook/Instagram
- **Meta CAPI** → registro de eventos de venda
- **Node.js (server.js)** → servidor local que espelha as rotas `/api/` do Vercel

---

## 🗺️ Arquitetura Geral

```
┌─────────────────────────────────────────────┐
│              BROWSER (Frontend)             │
│  login.html  │  index.html  │  share.html   │
└────────────┬──────────────────┬─────────────┘
             │                  │
             ▼                  ▼
┌──────────────────────────────────────────────┐
│           SERVIDOR (Vercel / server.js)       │
│  /api/config    → expõe config pública        │
│  /api/leads     → lê dados do Supabase        │
│  /api/leads-update → atualiza lead no Supabase│
│  /api/ads       → busca campanhas na Meta API │
│  /api/ads-accounts → lista contas de anúncio  │
│  /api/ads-best  → melhores criativos          │
│  /api/ads-demo  → dados demográficos          │
│  /api/ads-placement → dados por posicionamento│
│  /api/share-*   → sistema de links de acesso  │
└────────────┬──────────────────┬───────────────┘
             │                  │
             ▼                  ▼
     ┌──────────────┐   ┌──────────────────┐
     │  SUPABASE    │   │  META GRAPH API   │
     │  (BD + Auth) │   │  v20.0            │
     └──────────────┘   └──────────────────┘
```

---

## 🔐 Fluxo de Autenticação

### 1. Página de Login (`login.html`)
1. O browser carrega `login.html`
2. Chama `GET /api/config` → recebe `supabaseUrl` e `supabaseAnonKey` (sem segredos)
3. Inicializa o cliente Supabase no browser
4. Se já há sessão ativa → redireciona para `/` (dashboard)
5. Formulário de login: chama `supabase.auth.signInWithPassword()`
6. Supabase retorna um **JWT (token)** que fica salvo no `localStorage`
7. Redireciona para `/` após login com sucesso

### 2. Proteção das APIs
Todas as rotas protegidas usam o middleware `_auth.js`:
- Lê o header `Authorization: Bearer <token>`
- Valida o JWT contra o Supabase com `getUser(token)`
- Se inválido → retorna `401 Não autenticado`
- Se válido → prossegue com a requisição

---

## 📋 Abas do Dashboard (index.html)

O dashboard tem **5 abas principais** na sidebar:

### 1. 🧑‍🤝‍🧑 Leads Reais
- Busca todos os leads via `GET /api/leads` (com token do Supabase)
- Exibe tabela com: Nome, Telefone, Status, Mensagem, Plataforma, Data, Anúncio, Ações
- Funcionalidades:
  - **Filtro por período** (hoje, ontem, 7 dias, personalizado)
  - **Busca por nome/telefone**
  - **Exportar CSV**
  - **Paginação**
  - **Ordenação por coluna**
  - **Botão "Registrar Venda"** → abre modal de CAPI

#### 📦 Modal de Registro de Venda (CAPI)
- Ao clicar em "Registrar Venda" em um lead:
  1. Abre modal com o nome do lead
  2. Usuário preenche: Produto / Valor da Venda
  3. Ao confirmar → chama a Meta Conversions API (CAPI) server-side
  4. Registra evento `Purchase` no Pixel do Facebook
  5. Atualiza o status do lead no Supabase via `PATCH /api/leads-update`

---

### 2. 📊 Relatórios
- Exibe métricas agregadas dos leads do Supabase
- Gráficos com Chart.js: donut charts e bar charts
- Inclui **Funil de Conversão** interativo

---

### 3. 📣 Meta Ads
- Seleciona conta de anúncios via dropdown (carregado de `GET /api/ads-accounts`)
- Filtra por período (hoje, 7 dias, 30 dias, personalizado)
- Carrega campanhas via `GET /api/ads?accountId=...&datePreset=...`
- Exibe:
  - **Cards de KPIs**: gasto, impressões, cliques, leads, CPL, CTR, etc.
  - **Tabela de campanhas** com hierarquia (campanha → conjunto → anúncio)
  - **Funil visual** mostrando taxas de conversão
  - **Melhores Criativos** (`/api/ads-best`) com thumbnail e métricas
  - **Demográficos** (`/api/ads-demo`) com gráficos por idade/gênero/região
  - **Posicionamento** (`/api/ads-placement`) com breakdown feed/stories/reels

---

### 4. 🔗 Acesso ao Dash (Share)
- Gera links públicos para clientes visualizarem seus dados
- Modal de configuração permite escolher:
  - Nome do cliente
  - Seções visíveis (campanhas, demográficos, criativos)
  - Métricas e colunas da tabela
  - Status padrão ao abrir
  - Prazo de validade
- Gera link com token único salvo no Supabase via `/api/share-create`
- O link abre `share.html` — página pública sem login

---

### 5. ⚙️ Integrações (Config)
- Configurações da integração (contas Meta, Pixel, etc.)

---

## 🔄 Fluxo de Dados — Meta Ads

```
Usuário seleciona conta + período
        ↓
GET /api/ads?accountId=act_xxx&datePreset=last_30d
        ↓
Backend chama Meta Graph API v20.0
  → /act_xxx/campaigns?fields=name,status,insights{spend,ctr,...}
        ↓
Retorna JSON com campanhas e métricas
        ↓
Frontend calcula KPIs, renderiza tabela e gráficos
```

---

## 🔄 Fluxo de Dados — Leads

```
Dashboard carrega
        ↓
GET /api/leads (com JWT no header Authorization)
        ↓
Backend valida JWT via Supabase
        ↓
Busca todos os registros da tabela configurada (ex: rei_dos_colchoes)
        ↓
Retorna array de leads ao frontend
        ↓
Frontend aplica filtros, paginação e renderiza tabela
```

---

## 🏗️ Estrutura de Arquivos

| Arquivo | Função |
|---|---|
| `login.html` | Página de autenticação |
| `index.html` | Dashboard principal (todas as abas) |
| `share.html` | Dashboard público para clientes (sem login) |
| `server.js` | Servidor local (espelha rotas Vercel) |
| `api/_auth.js` | Middleware JWT |
| `api/_cache.js` | Cache em memória para API calls |
| `api/config.js` | Expõe config pública (sem segredos) |
| `api/leads.js` | Lê leads do Supabase |
| `api/leads-update.js` | Atualiza status/valor do lead |
| `api/ads.js` | Campanhas Meta |
| `api/ads-accounts.js` | Lista contas de anúncio |
| `api/ads-best.js` | Melhores criativos |
| `api/ads-demo.js` | Dados demográficos |
| `api/ads-placement.js` | Dados por posicionamento |
| `api/share-*.js` | Sistema de links públicos |

---

## 🌐 Variáveis de Ambiente (.env)

| Variável | Uso |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave pública (usada no browser) |
| `SUPABASE_SERVICE_KEY` | Chave secreta (usada só no servidor) |
| `SUPABASE_TABLE` | Nome da tabela de leads |
| `META_ADS_TOKEN` | Token de acesso à Meta Graph API |
| `PROJECT_NAME` | Nome do projeto (exibido no dashboard) |
| `PORT` | Porta do servidor local (padrão: 3000) |

---

## 🚀 Como Rodar Localmente

```bash
node server.js
# Acesse: http://localhost:3000
```

Rotas disponíveis localmente:
- `/` → dashboard (index.html)
- `/login.html` → login
- `/api/leads` → dados de leads
- `/api/ads` → dados Meta Ads
- `/api/config` → config pública
