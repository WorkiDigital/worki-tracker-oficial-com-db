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
- `api/webhook-evo.js`: Core da inteligência. Processa intenções, registra vendas e mapeia tempo de resposta.
- `api/logs-prune.js`: Handler de limpeza de banco de dados.
- `api/logs.js`: Endpoint de listagem com auto-pruning de 30 dias.
- `js/admin.js`: Lógica de gestão de logs, limpeza e administração de clientes.
- `index.html`: Dashboard principal com métricas de Ciclo Médio e SLA de Resposta.
