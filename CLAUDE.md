# WappTrack Evolution - Guia de Desenvolvimento

## 🚀 Novas Funcionalidades (Abril 2026)

### 1. Funil Temporal & Performance
O sistema agora rastreia todo o ciclo de vida do lead com timestamps precisos no PostgreSQL (`leads_tracking`):
- `created_at`: Entrada do lead.
- `first_response_at`: Primeiro atendimento humano.
- `qualified_at`: Quando o lead é qualificado.
- `proposal_sent_at`: Envio de proposta/orçamento.
- `sale_closed_at`: Fechamento da venda.
- `last_interaction_at`: Última mensagem trocada.

### 2. Lead Scoring (0-100)
Algoritmo de pontuação dinâmica baseado em intenção e comportamento:
- **Alta Intenção (+40 pts):** Palavras como "comprar", "fechar", "pagar".
- **Urgência (+25 pts):** "agora", "hoje", "rápido".
- **Orçamento (+15 pts):** "preço", "valor", "quanto".
- **Penalidade de Estagnação:** Leads sem resposta perdem pontos gradualmente.

### 3. Parser de Intenção (Webhook Evo)
O `api/webhook-evo.js` processa as mensagens e identifica flags:
- `tem_orcamento`: Detecta pedido de preço.
- `alta_intencao`: Identifica desejo claro de compra.
- `urgente`: Detecta necessidade imediata.
- `comparando`: Identifica menção à concorrência.

### 4. Dashboard de Métricas (`index.html`)
Novos indicadores no topo da aba de Leads:
- **Ciclo Médio:** Dias entre a criação e a venda.
- **Resposta Média:** Tempo em minutos para o primeiro contato humano.
- **Leads Esquecidos:** Leads sem interação há mais de 48h.
- **Vendas Rápidas:** Porcentagem de conversões em menos de 24h.
- **Filtro Inteligente (Multi-Tenant):** Os cards de métricas são sincronizados com o filtro global de clientes (`js/leads.js` -> `/api/metrics-temporal?cliente_id`), garantindo recálculo e visualização isolada em tempo real.
- **Gráfico de Linha do Tempo (Evolução Diária):** Localizado na aba de relatórios, o gráfico `cTimeline` exibe a entrada de Leads vs. Vendas por dia, facilitando a visualização de picos de conversão e sazonalidade.

### 6. Integridade e Precisão de Dados (Abril 2026)
Para garantir que as métricas de performance e SLA não sejam corrompidas por dados históricos legados ou inconsistentes, foi implementada uma trava global:
- **Data de Corte:** **2026-04-30**. 
- **Abrangência:** Todas as métricas temporais (`api/metrics-temporal.js`) e funções de cálculo de KPI no banco de dados (`get_dashboard_stats`) ignoram registros anteriores a esta data.
- **Impacto:** O Ciclo Médio e o SLA de Resposta agora refletem 100% da operação atual do WappTrack.

### 5. Gestão de Logs e Espaço
O sistema possui uma rotina de manutenção para evitar consumo excessivo de banco de dados:
- **Limpeza Automática:** Logs com mais de 30 dias são removidos silenciosamente ao acessar a aba de logs.
- **Limpeza Manual:** Endpoint `/api/logs-prune` permite remover logs antigos (padrão 15 dias) via UI.
- **Logging Seletivo:** O webhook apenas registra logs de eventos críticos (novos leads e vendas), ignorando conversas comuns para economizar espaço.
- **Rastreamento de Atendimento:** O sistema monitora mensagens `fromMe: true` para preencher automaticamente o `first_response_at` tanto em conversas normais quanto em fechamentos de venda.

## 📊 Mapeamento de Dados (Leads)
O rastro completo do lead inclui:
- **Identidade:** Nome, Telefone, Email, CPF.
- **Rastreamento:** UTMs (Campaign, Medium, Content), Ad ID, Page ID, Pixel.
- **Conversão:** Produto, Valor, Forma de Pagamento, Localização.
- **Performance:** SLA de resposta, Lead Score e Ciclo de Venda.

## 🛠️ Comandos Úteis

### Banco de Dados (PostgreSQL)
- `node setup-db.js`: Aplica migrações e adiciona novas colunas.
- `TRUNCATE TABLE webhook_logs;`: Limpa todos os logs do sistema instantaneamente.
- `TRUNCATE TABLE share_tokens;`: Remove todos os links de compartilhamento gerados.
- `DELETE FROM leads_tracking WHERE created_at < 'YYYY-MM-DD';`: Remove leads antigos.

### APIs Disponíveis
- `GET /api/metrics-temporal`: Retorna as métricas de performance.
- `GET /api/alerts-check`: Verifica leads negligenciados.
- `GET /api/metrics-funnel`: Retorna dados para o gráfico de funil.
- `POST /api/logs-prune?days=15`: Executa a limpeza manual de logs via interface.

## 📁 Estrutura de Arquivos Críticos
- `api/webhook-evo.js`: Core da inteligência. Processa intenções, registra vendas e mapeia tempo de resposta. (Atualizado em Maio/2026 com diagnóstico avançado de filtros).
- `api/logs-prune.js`: Handler de limpeza de banco de dados.
- `api/logs.js`: Endpoint de listagem com auto-pruning de 30 dias.
- `js/admin.js`: Lógica de gestão de logs, limpeza e administração de clientes.
- `index.html`: Dashboard principal com métricas de Ciclo Médio, SLA de Resposta e Gráfico de Linha do Tempo.
- `api/metrics-temporal.js`: Backend de cálculo de performance com trava de data de corte (2026-04-30).
- `js/leads.js`: Lógica de renderização de gráficos, filtros dinâmicos e comunicação com API de métricas.
- `api/evo-manager.js`: Gestão de instâncias da Evolution API (vínculo, criação e configuração automática de webhooks).

## 🚀 Novas Funcionalidades (Maio 2026)

### 1. Diagnóstico Avançado de Webhooks (`api/webhook-evo.js`)
Melhoria no rastreamento de leads para depuração de falhas de captura:
- **Logging de Filtros:** O sistema agora registra nos logs do painel o motivo exato de uma mensagem ser ignorada (ex: `no ctwaClid`, `not individual chat`, `not recognized instance`).
- **Rastreamento de Instâncias:** Logs indicam se a instância recebida da Evolution está corretamente vinculada a um cliente no banco de dados.
- **Autenticação Reforçada:** O webhook agora suporta e prioriza a validação do `WEBHOOK_SECRET` via parâmetro de URL (`?secret=...`), garantindo que o vínculo funcione mesmo em ambientes onde cabeçalhos HTTP são removidos.

### 2. Automação de Vínculo de Instâncias (`api/evo-manager.js`)
A funcionalidade de vincular instâncias existentes agora:
- Configura automaticamente a URL do Webhook na Evolution API apontando para o endpoint interno do Adlytics (`/api/webhook-evo`).
- Injeta o `WEBHOOK_SECRET` na URL de forma automática no momento do vínculo ou criação da instância.

### 3. Estabilização do Projeto (aDLYTCS)
O projeto foi formalmente identificado como **Adlytics**, consolidando a marca e a interface (`index.html` e `package.json`) sob esta identidade visual e funcional.

### 4. Correção Crítica — ReferenceError no Webhook (Maio 2026)
**Sintoma:** Todos os leads pararam de ser registrados após edição no `webhook-evo.js`.
**Causa:** A variável `cliente_id` estava sendo atribuída sem declaração (`cliente_id = cid`). Como o arquivo usa `import` (ESM), o strict mode é ativado automaticamente — e em strict mode, atribuir a variável não declarada lança `ReferenceError` antes de qualquer `INSERT`.
**Atenção:** Ao editar `api/webhook-evo.js`, sempre declarar variáveis com `const` ou `let`. Nunca assumir que uma variável existe por estar disponível em outro escopo.
