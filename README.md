# Adlytics — WhatsApp Tracking + Meta Ads CAPI (SaaS Multi-Tenant)

Sistema SaaS de rastreamento de leads via WhatsApp com envio automático de eventos para a Meta CAPI (Conversions API). Cada cliente tem seu próprio pixel, instâncias WhatsApp e template de venda.

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

| Serviço | Função |
|---------|--------|
| **Node.js 18+** | Runtime do backend |
| **PostgreSQL** | Banco de dados |
| **Evolution API** | Gerenciamento de instâncias WhatsApp (Baileys) |
| **EasyPanel** (recomendado) | Hospedagem com auto-deploy via GitHub |
| **Meta Business** | Pixel + Token de acesso para CAPI |

---

## Deploy no EasyPanel

### 1. Criar o serviço

1. EasyPanel → **New Service** → **App**
2. Conectar ao repositório GitHub: `WorkiDigital/worki-tracker-oficial-com-db`
3. Branch: `main`
4. Build command: `npm install`
5. Start command: `node server.js`

### 2. Variáveis de ambiente

Adicionar em **Environment** do serviço:

```env
DATABASE_URL=postgresql://user:senha@host:5432/banco
JWT_SECRET=uma_string_longa_e_aleatoria_minimo_32_chars
META_ADS_TOKEN=EAAI...
EVOLUTION_API_URL=https://evolution.seudominio.com
EVOLUTION_GLOBAL_KEY=sua_chave_global_evolution
WEBHOOK_SECRET=segredo_para_validar_webhooks   # opcional mas recomendado
```

> **JWT_SECRET ausente = qualquer pessoa pode forjar tokens de admin.** Nunca deixe em branco em produção.

### 3. Criar as tabelas no banco

No terminal do serviço (EasyPanel → Terminal):

```bash
node setup-db.js
```

Cria todas as tabelas e colunas. É seguro rodar múltiplas vezes (usa `IF NOT EXISTS`).

### 4. Criar o usuário admin

```bash
node -e "
import('dotenv/config').then(async () => {
  const { default: bcrypt } = await import('bcryptjs');
  const { default: pkg } = await import('pg');
  const pool = new pkg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const hash = await bcrypt.hash('SuaSenha123', 10);
  await pool.query(\"INSERT INTO usuarios (email, senha_hash, is_admin) VALUES ('admin@suaagencia.com', \$1, true)\", [hash]);
  console.log('Admin criado!');
  await pool.end();
});
"
```

---

## Estrutura Multi-tenant

```
Agência (admin, is_admin=true)
  └── Cliente A (cliente_id=1) → pixel: 111111111
  └── Cliente B (cliente_id=2) → pixel: 222222222
  └── Cliente C (cliente_id=3) → pixel: 333333333
```

- **Token Meta:** único da agência (`META_ADS_TOKEN`), com acesso a todos os pixels
- **Pixel:** cada cliente tem o seu próprio (`clientes.pixel_padrao`)
- **Token por cliente:** se `clientes.token_meta` preenchido, usa ele; caso contrário usa o da agência
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

A partir desse momento, o webhook usa esse template para extrair os dados da mensagem.

### Campos suportados

| Variável | Enviado à Meta CAPI | Campo no banco |
|----------|--------------------|----|
| `{valor}` | `custom_data.value` | `valor_venda` |
| `{nome}` | `fn` + `ln` (hash) | `nome` |
| `{cidade}` | `ct` (hash) | `cidade` |
| `{produto}` | `content_name` | `produto` |
| `{email}` | `em` (hash) | `email` |
| `{cpf}` | `external_id` (hash) | `cpf` |
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

## Banco de dados

### Tabelas

| Tabela | Descrição |
|--------|-----------|
| `usuarios` | Logins (admin + clientes) |
| `clientes` | Dados de cada cliente (pixel, token, template) |
| `leads_tracking` | Todos os leads com campos de venda |
| `instancias_mapeamento` | Instâncias externas vinculadas a clientes |
| `share_tokens` | Tokens de compartilhamento de dashboard |
| `webhook_logs` | Logs de todos os webhooks recebidos |

### Colunas principais de `leads_tracking`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `cliente_id` | INTEGER | Vínculo multi-tenant |
| `status` | VARCHAR | `Lead`, `Vendido`, `Pendente` |
| `valor_venda` | NUMERIC | Valor da compra |
| `produto` | VARCHAR | Produto vendido |
| `endereco` | TEXT | Endereço do cliente |
| `cidade` / `estado` | VARCHAR | Localização |
| `email` | VARCHAR | E-mail do cliente |
| `cpf` | VARCHAR | CPF do cliente |
| `cor` | VARCHAR | Cor/variação do produto |
| `forma_pagamento` | VARCHAR | Forma de pagamento |
| `ctw_aci_id` | TEXT | Click ID do anúncio |
| `utm_campaign` / `utm_medium` / `utm_content` | VARCHAR | UTMs extraídos da Meta API |

---

## Atualizar o banco após deploy

Sempre que houver mudança de schema, rode no terminal do EasyPanel:

```bash
node setup-db.js
```

---

## Segurança implementada

- JWT com `JWT_SECRET` obrigatório (alerta crítico se ausente)
- Rate limiting no login: 10 tentativas/IP por 15 minutos
- Validação de `WEBHOOK_SECRET` nos webhooks Evolution
- IDOR protegido: `verifyAccountAccess()` valida posse do `account_id`
- Cache isolado por usuário (`userCacheKey()`)
- `token_meta` nunca exposto no HTML — armazenado em `window._clientesMap`
- XSS sanitizado com `esc()` em todos os `innerHTML`

---

## Estrutura de arquivos

```
/
├── server.js              # Entry point — roteador de /api/*
├── setup-db.js            # Cria/migra todas as tabelas
├── index.html             # SPA do painel (admin + cliente)
├── api/
│   ├── _db.js             # Pool PostgreSQL
│   ├── _auth.js           # Verificação JWT
│   ├── _cache.js          # Cache isolado por usuário
│   ├── _validate.js       # Validações de segurança (IDOR)
│   ├── auth-login.js      # POST /api/auth-login
│   ├── clientes.js        # CRUD de clientes (admin)
│   ├── leads.js           # GET leads do cliente
│   ├── webhook-evo.js     # POST /api/webhook-evo (Evolution → Lead/Purchase)
│   ├── evo-manager.js     # Gerenciamento de instâncias WhatsApp
│   ├── ads.js             # Meta Ads (anúncios, métricas)
│   ├── logs.js            # GET logs do webhook
│   └── share-*.js         # Endpoints de dashboard compartilhado
└── docs/                  # Documentação interna
```
