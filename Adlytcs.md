# 📱 Adlytics - Documentação Completa do Ecossistema

Este documento centraliza todas as funcionalidades, arquitetura e inteligência do sistema **Adlytics**, focado em rastreamento de leads de alta precisão e otimização de conversões via WhatsApp.

---

## 🚀 Funcionalidades Principais

### 1. Rastreamento de Leads (Tracking)
O core do sistema reside no `api/webhook-evo.js`, que processa eventos da Evolution API.
- **Captura Automática:** Detecta mensagens vindas de anúncios "Click to WhatsApp".
- **Identificação de UTMs:** Consulta a API do Meta em tempo real para extrair `utm_campaign`, `utm_medium` e `utm_content` com base no `ad_id` do anúncio.
- **Identidade do Lead:** Salva nome (pushName), telefone, plataforma (FB/IG) e thumbnail do anúncio.
- **Persistência Dinâmica:** Registra o lead na tabela `leads_tracking` com isolamento por cliente e instância.

### 2. Inteligência e Lead Scoring (Fase 2)
O sistema não apenas salva, mas qualifica o lead instantaneamente:
- **Lead Score (0-100):** Calcula uma pontuação baseada no conteúdo da mensagem:
    - **Alta Intenção (+40 pts):** Palavras como "comprar", "fechar", "pagar".
    - **Urgência (+30 pts):** "agora", "hoje", "rápido".
    - **Orçamento (+20 pts):** "preço", "valor", "quanto".
- **Penalidade de Estagnação:** O score diminui se o lead ficar muito tempo sem interação.

### 3. Funil Temporal e Performance (SLA)
Métricas focadas na eficiência comercial (`api/metrics-temporal.js`):
- **Ciclo Médio de Venda:** Tempo decorrido entre a criação do lead e o status "Vendido".
- **SLA de Resposta:** Tempo (em minutos) entre a chegada do lead e o primeiro atendimento humano (`first_response_at`).
- **Leads em Risco:** Alerta para leads sem interação há mais de 48h.
- **Vendas Rápidas:** Porcentagem de vendas fechadas em menos de 24h.

### 4. Integração Meta CAPI (Conversões)
O Adlytics fecha o ciclo de feedback para os algoritmos do Meta:
- **LeadSubmitted:** Enviado assim que o lead entra no sistema.
- **Purchase (Venda):** Enviado quando uma venda é detectada ou marcada manualmente.
- **Deduplicação:** Envia o `ctwa_clid` e dados hasheados (SHA-256) para garantir 100% de precisão na atribuição.

### 5. Gestão de Instâncias (Evolution Manager)
Interface simplificada para gerenciar conexões de WhatsApp (`api/evo-manager.js`):
- **Vínculo Automático:** Conecta instâncias existentes da Evolution ao cliente do Adlytics.
- **Configuração de Webhook:** Injeta automaticamente a URL de destino e o `WEBHOOK_SECRET` na instância.
- **Sincronização:** Garante que cada mensagem seja atribuída ao cliente correto via mapeamento de instâncias.

---

## 🛠️ Arquitetura e Funções Críticas

### Backend (Node.js/Vercel)
- `api/webhook-evo.js`: O cérebro do sistema. Processa leads e vendas.
- `api/metrics-temporal.js`: Motor de cálculo de KPIs e performance.
- `api/leads.js`: Listagem otimizada de leads para o CRM.
- `api/_db.js`: Gerenciamento do Pool de conexões PostgreSQL.
- `api/_auth.js`: Validação de tokens e segurança multi-tenant.

### Frontend (Vanilla JS + Tailwind/CSS)
- `js/leads.js`: Gerencia a UI dos leads, filtros dinâmicos e renderização de gráficos.
- `js/admin.js`: Interface administrativa para gestão de clientes e logs.
- `js/share-dash.js`: Lógica para dashboards compartilháveis (visualização externa).
- `index.html`: Dashboard unificado com cards de métricas e gráficos de linha do tempo.

### Banco de Dados (PostgreSQL)
- `leads_tracking`: Tabela principal com todos os eventos e metadados.
- `clientes`: Configurações de Pixel, Token do Meta e templates de venda.
- `instancias_mapeamento`: Vínculo entre nome da instância na Evolution e ID do cliente.
- `webhook_logs`: Registro histórico de eventos para diagnóstico.

---

## 🔒 Segurança e Integridade
- **WEBHOOK_SECRET:** Validação obrigatória para evitar injeção de dados falsos.
- **Trava de Data (2026-04-30):** Filtro global que ignora dados legados para manter as métricas de 2026 limpas.
- **Auto-Pruning:** Limpeza automática de logs com mais de 30 dias para otimização de custo e performance.

---

## 🔧 Funções Técnicas (Code Functions)

Abaixo estão as funções mais importantes que governam a lógica do sistema:

### Backend (`api/`)

#### `api/webhook-evo.js`
- `getMessageFlags(message)`: Analisa o texto da mensagem em busca de padrões de intenção (preço, compra, urgência).
- `calculateLeadScore(flags, lastInteraction)`: Atribui uma nota de 0 a 100 ao lead baseada nas flags detectadas.
- `sendCapiLead(lead, pixel, token)`: Envia o evento `LeadSubmitted` para a API de Conversões do Meta.
- `sendCapiPurchase(lead, pixel, token)`: Envia o evento `Purchase` quando uma venda é confirmada.
- `parseTemplate(template)`: Extrai dados estruturados (valor, nome, cidade) de mensagens enviadas pelo comercial seguindo um padrão.

#### `api/metrics-temporal.js`
- `calculateAverageCycle()`: Calcula a média de tempo entre a criação e o fechamento da venda.
- `calculateSLA()`: Mede o tempo até a primeira resposta humana (`first_response_at`).

#### `api/evo-manager.js`
- `configureWebhook(instanceName, secret)`: Configura via API externa os parâmetros de destino e segurança da Evolution.

### Frontend (`js/`)

#### `js/leads.js`
- `recarregarLeads()`: Puxa dados da API, popula filtros e atualiza a tabela.
- `carregarMetricasTemporais()`: Atualiza os cards superiores (Ciclo Médio, SLA) filtrando por cliente e data.
- `renderTimelineChart()`: Gera o gráfico de linha do tempo comparando Leads vs Vendas usando Chart.js.
- `aplicarFiltros()`: Lógica central de filtragem por texto, período, instância e cliente admin.

#### `js/admin.js`
- `pruneLogs(days)`: Chama o endpoint de limpeza de logs antigos.
- `switchClient(clientId)`: Altera o contexto do dashboard para visualizar dados de um cliente específico (modo admin).

---

*Documento gerado automaticamente para consolidar o conhecimento técnico do Adlytics.*
