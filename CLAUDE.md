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

### 6. Integridade e Precisão de Dados (Abril 2026 — Atualizado Mai 2026)
- **Data de Corte Removida:** A trava fixa `created_at >= '2026-04-30'` foi removida em 13/05/2026. As métricas agora utilizam um filtro dinâmico de 30 dias (`NOW() - INTERVAL '30 days'`) ou o período enviado via query params (`start`/`end`), sem limitar dados arbitrariamente.
- **Impacto:** O Ciclo Médio e o SLA de Resposta refletem os dados reais do período selecionado.

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
- `api/metrics-temporal.js`: Backend de cálculo de performance dos leads (Ciclo Médio, Resposta Média, Leads Esquecidos, Vendas Rápidas). Consulta exclusivamente a tabela `leads_tracking` no PostgreSQL.
- `js/leads.js`: Lógica de renderização de gráficos, filtros dinâmicos e comunicação com API de métricas.
- `api/evo-manager.js`: Gestão de instâncias da Evolution API (vínculo, criação e configuração automática de webhooks).
- `middleware/rateLimit.js`: Proteção contra ataques de negação de serviço e spam nos webhooks.
- `api/_crypto.js`: Utilitário central de criptografia para segurança de tokens no banco de dados.

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

### 5. Segurança, Performance e Infraestrutura (08/05/2026)
Consolidação da robustez do sistema com foco em proteção e velocidade:
- **Rate Limiting por IP:** Implementação de proteção contra abusos no endpoint de webhooks (`middleware/rateLimit.js`), limitando a 100 requisições por minuto por IP.
- **Cache Inteligente Meta Ads:** Camada de cache persistente para métricas da Meta Ads, otimizando o carregamento de dashboards e economizando cota de API.
- **Criptografia de Tokens:** Migração para armazenamento criptografado de tokens de acesso de APIs externas, aumentando a segurança do banco de dados.
- **Persistência de Preferências:** Nova tabela `dashboard_settings` para salvar filtros e configurações de visualização por conta de anúncio.
### 6. Otimização Crítica de Logs e Dashboard (08/05/2026)
Uma reengenharia completa foi realizada para resolver lentidões extremas no painel administrativo e restaurar a precisão dos KPIs:
- **Segregação de Endpoints de Logs**:
    - `GET /api/logs/lite`: Novo endpoint para a tabela administrativa que retorna apenas um preview do payload (`data_preview`), reduzindo o tamanho da resposta de 400KB para ~30KB por linha.
    - `GET /api/logs/:id`: Endpoint dedicado para carregar o JSON completo sob demanda via modal, suportando fallback entre a nova tabela `webhook_logs` e a tabela legada `logs`.
    - `GET /api/logs`: Restaurado para retornar o JSON completo, essencial para que as funções de cálculo de métricas do dashboard não quebrem.
- **Automação de Métricas do Funil**:
    - **Venda Automática**: O sistema agora detecta e grava automaticamente o timestamp `sale_closed_at` quando um lead é marcado como "Vendido" ou "Venda", alimentando os cards de Ciclo Médio e Vendas Rápidas em tempo real.
    - **SLA de Resposta**: O `api/webhook-evo.js` monitora interações para preencher `first_response_at` e `last_interaction_at`, garantindo a precisão do card de Resposta Média.
- **Infraestrutura de Banco de Dados**:
    - **Tabela `webhook_logs`**: Nova tabela otimizada para logs de alta volumetria.
    - **Índices de Performance**: Criados `idx_logs_cliente_created` e `idx_logs_tag` para garantir que as buscas de logs ocorram em milissegundos, mesmo com milhões de registros.
- **Suporte a Rotas Dinâmicas**: O servidor de desenvolvimento (`server.js`) foi atualizado para suportar o padrão de arquivos `[id].js`, alinhando a arquitetura local com a do Vercel.
- **Correção ReferenceError (CAPI Purchase)**: Resolvido bug `token is not defined` no envio de eventos de compra para o Facebook, garantindo que o token do cliente seja priorizado corretamente.

### 7. Otimização de Interface e Estilos (08/05/2026)
Uma limpeza profunda foi realizada no dashboard principal para melhorar a manutenibilidade e performance de renderização:
- **Extração de Design Tokens**: As cores literais e paddings mais utilizados foram mapeados via script de auditoria e movidos para variáveis nativas CSS (`:root`) no topo do arquivo `css/dashboard.css`.
- **Classes Utilitárias**: Criadas classes como `.text1`, `.bg2`, `.pad-sm`, `.pad-md`, `.pad-lg` para substituir a proliferação de estilos inline (`style="..."`).
- **Refatoração do HTML**: O arquivo `index.html` teve milhares de atributos de estilo substituídos pelas novas classes utilitárias, reduzindo o tamanho do DOM sem causar impacto visual (abordagem *pixel-perfect* baseada nos valores exatos de uso atual).
- **Inventário Visual**: O arquivo `pattern-inventory.json` foi atualizado com os padrões consolidados de uso, servindo de documentação viva para futuras alterações de UI.

### 8. Correção Crítica — Métricas Temporais Quebradas (13/05/2026)
**Sintoma:** Os 4 cartões de métricas (Ciclo Médio, Resposta Média, Leads Esquecidos, Vendas Rápidas) pararam de exibir dados, mostrando apenas `–` no dashboard.
**Causa Raiz:** O endpoint `api/metrics-temporal.js` continha uma query pesada à API da Meta Ads (gastos, cliques, impressões) que **não tinha relação** com as métricas de tempo de atendimento. Quando essa query falhava (token expirado, timeout, etc.), derrubava toda a resposta da rota, impedindo até os dados válidos do banco de chegarem ao frontend.
**Correção:**
- Removida toda a lógica de busca à Meta Ads (`fetchMeta`, `getCachedMetrics`, `setCachedMetrics`) do arquivo.
- Removida a trava de data fixa `created_at >= '2026-04-30'` que limitava os dados consultados.
- Adicionado `try/catch` global para garantir que erros de banco retornem um JSON limpo em vez de derrubar a rota.
- O arquivo agora faz exclusivamente: consulta SQL ao `leads_tracking` → calcula os 4 KPIs → retorna JSON.
### 9. Relatórios Automatizados via WhatsApp (14/05/2026)
Implementação de um motor de relatórios agendados que envia métricas do Meta Ads diretamente para grupos ou contatos via WhatsApp:
- **Motor de Cron (`api/cron/send-reports.js`):** Endpoint responsável por consultar agendamentos no banco, extrair métricas em tempo real e disparar via Evolution API.
- **Templates Dinâmicos:** Sistema de modelos de mensagem que suporta tags dinâmicas como `{gasto}`, `{leads}`, `{cpl}`, `{msgs}`, `{cliques}`, `{ctr}`, `{roas}`, `{cpc}`, `{cpm}`, `{alcance}` e `{impressoes}`.
- **Interface de Agendamento:** Nova seção na aba "Relatórios Zap" com seletor de instância global, listagem de grupos automática e configuração de frequência (Diário/Semanal) e horário.
- **Infraestrutura:** Tabela `relatorios_agendados` criada para persistir configurações e templates por cliente.

### 10. Evolução de Métricas Instagram Ads (14/05/2026)
Aprimoramento da precisão dos dados para campanhas focadas em perfil de Instagram:
- **Visitas ao Perfil:** Implementada a métrica nativa `instagram_profile_visits` para rastreamento preciso de tráfego para o perfil.
- **Seguidores (Instagram Follows):** Resolvida a limitação de busca de seguidores via array de ações nativas da Meta, corrigindo o erro `#100` e garantindo a captura real de novos seguidores atribuídos aos anúncios.

### 11. Automação e Robustez Evolution (14/05/2026)
Melhorias na integração com a Evolution API para facilitar a escala:
- **Sync Groups/Contacts:** Novas instâncias agora são configuradas automaticamente para sincronizar grupos e contatos, garantindo que os destinos de relatórios apareçam instantaneamente no sistema.
- **Eventos Webhook:** Inclusão do evento `GROUPS_UPSERT` no registro de webhooks para manter a lista de grupos sempre atualizada.
- **Robustez de URL:** Implementada codificação de URL (`encodeURIComponent`) nas rotas de busca de grupos para evitar falhas com instâncias que possuem nomes especiais.

### 12. Splash Screen Premium Pós-Login (Junho 2026)
Implementação de uma animação de introdução visual de alto impacto (estética SaaS Premium) logo após o login e antes do carregamento completo do dashboard:
- **Fluxo Visual:** Exibição sequencial temporizada das palavras-chave ("Rastreie", "Atribua", "Venda mais") seguidas de uma revelação em grande escala do logotipo **Adlytics Pro**.
- **Efeitos Cinematográficos:** Aura pulsante (breathing glow azul/verde), anéis de luz expansivos em cascata e transições suaves de opacidade/desfoque com dark mode imersivo.
- **Arquitetura Técnica:** Componente isolado e sobreposto em `index.html` (`#premiumSplash`), estilizado de forma modular em `css/splash.css`. Ativado no client-side via flag transiente `sessionStorage.getItem('play_splash')` injetada pela rota de login, garantindo que só rode na transição inicial. Duração de exibição calibrada para 8 segundos.
