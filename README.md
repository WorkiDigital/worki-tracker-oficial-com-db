# Adlytics — WhatsApp Tracking + Meta Ads SaaS

Sistema multi-tenant de rastreamento de leads via WhatsApp com envio automático de eventos para a Meta CAPI (Conversions API).

---

## Visão Geral

```
Cliente manda mensagem no WhatsApp
  → Evolution API recebe
  → N8N normaliza e envia para /api/webhook-n8n
  → Backend salva lead no banco (PostgreSQL)
  → Ao marcar como Venda → CAPI envia evento Purchase para a Meta
```

---

## Pré-requisitos

| Serviço | Descrição |
|---------|-----------|
| **EasyPanel** | Hospedagem do backend Node.js + PostgreSQL |
| **Evolution API** | Gerenciamento de instâncias WhatsApp (Baileys) |
| **N8N** | Automação: recebe webhook da Evolution e repassa para o backend |
| **PostgreSQL** | Banco de dados (provisionado pelo EasyPanel) |
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

Adicionar no painel **Environment** do serviço:

```env
DATABASE_URL=postgresql://user:senha@host:5432/banco
JWT_SECRET=uma_string_longa_e_aleatoria
META_ADS_TOKEN=EAAI...  # Token da agência com acesso a todos os pixels
EVOLUTION_API_URL=https://evolution.seudominio.com
EVOLUTION_GLOBAL_KEY=sua_chave_global_evolution
N8N_WEBHOOK_URL=https://n8n.seudominio.com/webhook/XXXX  # URL do webhook N8N
```

### 3. Criar as tabelas no banco

No terminal do serviço (EasyPanel → Terminal):

```bash
node setup-db.js
```

### 4. Criar o usuário admin

No terminal do serviço:

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
Agência (admin)
  └── Cliente A (cliente_id=1) → pixel: 111111111
  └── Cliente B (cliente_id=2) → pixel: 222222222
  └── Cliente C (cliente_id=3) → pixel: 333333333
```

- **Token Meta:** único da agência (`META_ADS_TOKEN`), com acesso a todos os pixels
- **Pixel:** cada cliente tem o seu próprio
- **Instâncias Evolution:** prefixadas automaticamente (`cliente_1_NomeLoja`)

---

## Configuração do N8N

### Importar o fluxo

1. N8N → **Import from JSON**
2. Importar o arquivo `n8n-workflow.json` fornecido junto com o projeto

### O fluxo faz:

1. **Trigger:** Recebe webhook da Evolution (`MESSAGES_UPSERT`)
2. **Filtra:** Apenas mensagens recebidas de contatos (não grupos)
3. **Normaliza Lead:** Extrai nome, telefone, mensagem, instance
4. **POST** para `https://seuapp.easypanel.host/api/webhook-n8n`

### Payload enviado pelo N8N:

```json
{
  "instance": "cliente_7_LojaPrincipal",
  "evento": "lead",
  "nome": "João Silva",
  "telefone": "5511999999999",
  "mensagem_recebida": "Olá, vi o anúncio...",
  "ctw_aci_id": "...",
  "source_id": "...",
  "event_source_url": "https://loja.com",
  "anuncio_thumbnail_url": "https://..."
}
```

O campo `instance` identifica automaticamente o cliente — **não precisa de cliente_id hardcoded**.

---

## Adicionar Clientes

1. Logar como admin em `https://seuapp.easypanel.host`
2. Menu **Agência** → **Novo Cliente**
3. Preencher: Nome, Pixel Meta, E-mail, Senha
4. O sistema cria o cliente + usuário de acesso automaticamente
5. Compartilhar email/senha com o cliente

---

## Conectar WhatsApp do Cliente

1. Logar como o cliente (ou como admin)
2. Menu **Conexão WhatsApp** → **Nova Conexão**
3. Digitar o nome da instância (ex: `Loja Principal`)
4. Sistema cria a instância na Evolution **e já configura o webhook do N8N automaticamente**
5. Escanear QR Code com o celular
6. Pronto — leads chegando automaticamente

---

## Fluxo de Venda (CAPI Purchase)

1. No painel **Leads Reais**, localizar o lead
2. Clicar em **Venda**
3. Informar o valor
4. Backend atualiza status para `Vendido` e envia evento `Purchase` para a Meta CAPI

---

## Atualizar o Banco (migrations)

Sempre que houver mudança de schema, rode no terminal do EasyPanel:

```bash
node setup-db.js
```

O script usa `IF NOT EXISTS` e `ADD COLUMN IF NOT EXISTS` — é seguro rodar múltiplas vezes.
