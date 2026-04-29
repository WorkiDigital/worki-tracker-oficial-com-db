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

## 🛠️ Comandos Úteis

### Banco de Dados
- `node setup-db.js`: Aplica migrações e adiciona novas colunas.
- `node reset-db.js`: Reinicializa as tabelas (CUIDADO).

### APIs Disponíveis
- `GET /api/metrics-temporal`: Retorna as métricas de performance.
- `GET /api/alerts-check`: Verifica leads negligenciados.
- `GET /api/metrics-funnel`: Retorna dados para o gráfico de funil.

## 📁 Estrutura de Arquivos Críticos
- `api/webhook-evo.js`: Core da inteligência e recebimento de mensagens.
- `api/_metrics_helper.js`: Cálculos de intervalos de tempo.
- `js/leads.js`: Lógica de renderização da tabela e dos cards no frontend.
- `index.html`: UI principal com os novos componentes de métricas.
