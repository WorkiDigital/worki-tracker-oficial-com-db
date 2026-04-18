# 📑 Documento de Requisitos Técnicos (PRD) - Migração Worki Tracker (Lovable + Supabase)

Este documento detalha a arquitetura e as especificações técnicas para a migração completa do sistema **Worki Tracker (Adlytics)** para a plataforma **Lovable**, utilizando **React/Vite** no frontend e **Supabase** no backend.

---

## 1. 🗄️ Arquitetura de Banco de Dados (Schema Relacional)

A estrutura será migrada para o PostgreSQL do Supabase, aproveitando UUIDs e Row Level Security (RLS) para total isolamento multi-tenant.

### Tabelas e Estrutura

#### `public.clientes` (Tabela de Tenants)
*   **id**: `uuid` (Primary Key, default: `gen_random_uuid()`)
*   **nome**: `text` (Not Null)
*   **email_contato**: `text` (Unique)
*   **pixel_padrao**: `text` (ID do Pixel Meta)
*   **token_meta**: `text` (Token de Acesso à Graph API)
*   **account_id**: `text` (ID da Ad Account, ex: `act_...`)
*   **template_venda**: `text` (Template para extração de dados de venda)
*   **permissoes**: `jsonb` (Default: `{"leads":true, "anuncios":true, "relatorios":true, "whatsapp":true, "config":true}`)
*   **criado_em**: `timestamptz` (Default: `now()`)

#### `public.usuarios` (Vínculo com Auth Supabase)
*   **id**: `uuid` (Primary Key, vinculado ao `auth.users.id`)
*   **cliente_id**: `uuid` (FK para `clientes.id`)
*   **is_admin**: `boolean` (Default: `false`)
*   **nome**: `text`

#### `public.leads_tracking` (Tabela Principal de Dados)
*   **id**: `bigint` (Primary Key, Serial)
*   **cliente_id**: `uuid` (FK para `clientes.id`, Indexado)
*   **event_time**: `timestamptz` (Data do contato)
*   **nome**: `text`
*   **telefone**: `text` (Indexado)
*   **mensagem_recebida**: `text`
*   **instancia**: `text` (Nome da instância Evolution)
*   **plataforma**: `text` (facebook, instagram, whatsapp)
*   **utm_campaign**: `text`, **utm_medium**: `text`, **utm_content**: `text`
*   **pixel**: `text`
*   **ctw_aci_id**: `text` (ID de clique do WhatsApp Ads - Crucial para CAPI)
*   **source_id**: `text` (ID do anúncio Meta)
*   **page_id**: `text` (ID da Fanpage)
*   **status**: `text` (Default: 'Lead', opções: Lead, Pendente, Vendido, Perdido)
*   **valor_venda**: `numeric(10,2)`
*   **produto**: `text`, **cpf**: `text`, **email**: `text`, **endereco**: `text`
*   **cidade**: `text`, **estado**: `text`
*   **metadados**: `jsonb` (Para campos extras)

#### `public.share_tokens` (Dashboard Compartilhado)
*   **token**: `text` (Primary Key, link público único)
*   **cliente_id**: `uuid` (FK para `clientes.id`)
*   **account_id**: `text`
*   **visible_sections**: `jsonb` (Quais abas habilitar)
*   **status_filter**: `text` (Default: 'ACTIVE')
*   **expires_at**: `timestamptz` (Opcional)

#### `public.instancias_mapeamento`
*   **instance_name**: `text` (Primary Key)
*   **cliente_id**: `uuid` (FK para `clientes.id`)

### 🛡️ Regras de Segurança (RLS)
1.  **Isolamento de Tenant**: Todo `SELECT`, `UPDATE` e `DELETE` deve ser filtrado por `cliente_id = auth.jwt() ->> 'cliente_id'`.
2.  **Admin Privileges**: Apenas usuários com `is_admin = true` podem gerenciar a tabela `clientes`.
3.  **Acesso Público (Share Tokens)**: Criar uma view ou função `RPC` que permita leitura na tabela `leads_tracking` filtrada pelo `token` sem autenticação JWT (usando API key pública do Supabase).

---

## 2. 🗺️ Mapa de Telas e Interface de Usuário (UI/UX)

### Estrutura de Páginas (Routes)
1.  **`/login`**: Autenticação com Supabase Auth (Email/Senha).
2.  **`/dashboard`**:
    *   **Aba Leads Reais**: Lista de cards/tabela com contatos vindo dos anúncios. Botão "Registrar Venda" abre modal com campos de venda.
    *   **Aba Relatórios**: Visualização de funil, pizza de status de leads e geolocalização (Estados/Cidades).
    *   **Aba Meta Ads**: Métricas de desempenho (Gasto, Impressões, CPL). Integração com o buscador de contas de anúncios.
    *   **Aba Melhores Criativos**: Cards de performance dos anúncios com prévia de vídeo/imagem.
3.  **`/config`**:
    *   **Integrações**: Configurações de Webhook e Token da Meta.
    *   **WhatsApp**: Painel de controle da Evolution API (Gerar QR Code, Status de conexão).
4.  **`/admin`**: Painel exclusivo para agência gerenciar os sub-anunciantes (Clientes SaaS).
5.  **`/share/:token`**: Dashboard simplificado e público para o cliente final.

### Jornada do Usuário
1.  **Agência** cria o Cliente no sistema.
2.  **Cliente/Agência** conecta o WhatsApp via Evolution (QR Code) na aba WhatsApp.
3.  **Leads** chegam através de anúncios do Meta/WhatsApp.
4.  O **Webook Evolution** salva o lead e extrai o `ctwaClid`.
5.  O **Atendente** conversa e fecha a venda, colando o template na conversa.
6.  O **Sistema/Atendente** registra a venda → Dispara CAPI `Purchase`.
7.  O **Dashboard** mostra o ROI em tempo real.

---

## 3. ⚙️ Regras de Negócio e Estado (Business Logic)

### Ações Principais (Edge Functions)
*   **`webhook-evolution`**: Gatilho: Mensagem recebida. Ação: Identifica cliente, busca UTMs via Meta Graph API, salva lead, dispara CAPI Lead.
*   **`registrar-venda`**: Gatilho: Ação manual ou mensagem template. Ação: Atualiza status para 'Vendido', calcula valor, dispara CAPI Purchase (Meta Conversions API).

### Validações
*   **Duplicidade**: Não permitir dois leads com o mesmo telefone para o mesmo `cliente_id` em um intervalo curto (deduplicação).
*   **Segurança**: Garantir que um token Meta de um cliente nunca seja usado para carregar dados de outro.

### Gerenciamento de Estado (React)
*   Utilizar `React Query` ou `SWR` para cache das métricas Meta Ads.
*   Utilizar `Supabase Realtime` para atualizar a tabela de leads sem recarregar a página.

---

## 4. 🔌 APIs, Webhooks e Integrações Externas

### Endpoints Cruciais
*   **Meta Graph API**: `v25.0/{ad_id}/insights` (Para performance) e `v25.0/{pixel_id}/events` (Para CAPI).
*   **Evolution API**: `/instance/create`, `/instance/qrcode`, `/instance/logout`.
*   **n8n Webhook**: Disparo de payload JSON para automações externas após registro de lead.

---

## 5. 🚀 MASTER PROMPT PARA O LOVABLE

**Instrução Final para Geração do Projeto:**

```text
Atue como um Engenheiro Fullstack Specialist. Construa uma plataforma SaaS em React (Vite) + Supabase chamada "Worki Tracker". 

OBJETIVO: Dashboard Multi-tenant para rastreamento de leads de WhatsApp Ads e performance de Meta Ads com CAPI nativa.

PRINCIPAIS TELAS:
1. 'Leads Reais': Tabela avançada filtrada por 'cliente_id'. Deve ter busca por telefone/nome e filtros de UTM. Botão "Registrar Venda" que abre um modal para dados de venda (Produto, Valor, Email, CPF, Endereço). Ao confirmar, chama uma API/Edge Function Supabase para enviar evento 'Purchase' para a Meta Conversions API.
2. 'Analytics Meta': Grid de métricas financeiras (Gasto, Impressões, CPM, CTR, CPC, CPL). Consome dados da Meta Graph API (usar token e pixel armazenado na tabela 'clientes').
3. 'Galeria de Criativos': Exibe os melhores anúncios com thumbnails e métricas de leads.
4. 'Gestor WhatsApp': Integração com Evolution API. Deve gerar e exibir QR Code para conexão de novos aparelhos.

ESTRUTURA DE DADOS (Supabase):
- Tabela 'clientes': dados de configuração e tokens Meta.
- Tabela 'leads_tracking': todos os dados de contato, UTMs, ctwa_clid (ID de clique meta) e status da venda.
- RLS: Configurar Row Level Security para isolamento total entre sub-contas (clientes).

DESIGN:
- Dark Mode Premium (Glassmorphism), Sidebar colapsável, animações fluidas (Framer Motion ou CSS Transitions).
- Use Lucide-react para ícones e Chart.js para relatórios visuais (Funil de Vendas e Pizza de Status).

REGRAS: 
- Use TypeScript.
- Implemente Supabase Auth para login de clientes.
- Crie um componente reutilizável para exibição de Toasts de sucesso/erro.
```
