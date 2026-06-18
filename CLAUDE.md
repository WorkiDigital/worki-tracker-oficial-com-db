# Worki Tracker Oficial - Documentação do Projeto

Bem-vindo ao projeto **Worki Tracker Oficial**. Este arquivo serve como um guia rápido para Inteligências Artificiais e Desenvolvedores sobre a arquitetura e padrões do projeto.

## 🚀 Arquitetura e Tech Stack
- **Backend:** Node.js (Vanilla, sem frameworks complexos).
- **Frontend:** HTML Vanilla, CSS, JS. O painel é uma Single Page Application (SPA) baseada no arquivo `index.html`.
- **Estilo:** Design premium e responsivo (Dark/Light mode automático), uso da biblioteca de ícones `lucide` (via CDN).
- **Banco de Dados:** PostgreSQL hospedado em container/serviço separado (acessado via `pg-pool`).
- **Webhooks:** Recebimento de webhooks do WhatsApp via Evolution API.

## 📁 Estrutura de Arquivos Principal
- `/index.html`: Dashboard principal (Front-end SPA). Todas as abas, modais e layouts de UI estão aqui.
- `/js/admin.js`, `/js/leads.js`, `/js/auth.js`: Lógica do frontend.
- `/api/_db.js`: Gerenciador de conexão com o PostgreSQL.
- `/api/webhook-evo.js`: Arquivo CRÍTICO que recebe os webhooks da Evolution API. Processa a lógica de criação de leads e disparo do CAPI (Meta Conversions API).
- `/api/clientes.js`: Endpoints REST para gerenciamento de clientes/contas.
- `/setup-db.js`: Script de migração e criação das tabelas do banco de dados (Deve ser rodado diretamente via Node após alterações de schema).

## 💡 Padrões e Regras de Implementação
1. **Design UI/UX:** Sempre manter a estética premium. Modais novos e componentes devem usar o estilo padrão do dashboard (`modal-overlay`, `modal-head`, botões padronizados, etc).
2. **Ícones:** Usar exclusivamente a biblioteca `lucide` (`<i data-lucide="nome"></i>`). Não injetar cores (`color: blue;`) nos ícones de navegação do menu lateral; eles devem herdar do CSS nativo para suportar estados ativos (azul) e inativos (cinza).
3. **Variáveis de Ambiente:** Configuradas no arquivo `.env`. Para migrações de banco executadas via bash (`setup-db.js`), sempre incluir o `dotenv/config` (ex: `node -r dotenv/config setup-db.js`).

## 🔗 Funcionalidades Chave Recentes
- **CAPI Leads e CAPI Purchase:** O sistema se integra à Meta API enviando eventos de conversão e rastreamento avançado.
- **CAPI QualifiedLead (Nova Feature):** 
  - Adicionado suporte a qualificação manual via botão "Venda / Qualificar" no painel.
  - Gatilho automático configurável via painel (ex: o usuário responde `#qualificado` no WhatsApp, o sistema reconhece e envia o evento `QualifiedLead` pra Meta API).
- **White-label Personalizado:** Admins podem trocar o Nome do Projeto e Logotipo na aba Configurações (que estava oculta e foi destravada recentemente).

## ⚠️ Atenção (Erros Comuns)
- O `api/webhook-evo.js` é o coração do sistema. Nunca sobreponha ou apague partes deste arquivo a menos que saiba exatamente o impacto na captação dos leads.
- A exclusão acidental do conteúdo do `webhook-evo.js` ocorreu no passado, o arquivo foi restaurado a partir do histórico do git. Sempre valide diffs grandes!
- A página `index.html` não carrega frameworks de componentes (React/Vue). Modificações DOM devem ser feitas através do JS Vanilla (`$('id').innerHTML` e etc).

## 🔧 Troubleshooting CAPI (Meta Conversions API) — IMPORTANTE

> **Antes de mexer no payload, SEMPRE olhe o log real e o `error_subcode` da Meta.** A causa quase nunca é o que parece. Não adivinhe — o subcode diz exatamente o que fazer. Os logs de CAPI ficam na aba **Logs do Sistema** (tabela `webhook_logs`, coluna correta é `instance`, NÃO `instance_name`) e no console do servidor.

**Regra de ouro:** o evento `LeadSubmitted` (disparado pelo `webhook-evo.js`) é a **referência do que a Meta ACEITA**. Se Purchase/QualifiedLead falham e o Lead passa, compare os dois payloads — a diferença é a causa.

### Canal usado: `action_source: business_messaging` + `messaging_channel: whatsapp`
Esse canal tem regras próprias (diferentes da CAPI web). Campos do `user_data`:
- **Obrigatório:** `page_id` (ou `whatsapp_business_account_id`). Sem ele → rejeição.
- **Aceitos:** `ctwa_clid` (NÃO hashear), `ph`, `em`, `fn`, `ln`, `external_id`, `ct`, `st`, `country` (todos hasheados SHA-256, preferir array `[hash]`).
- **PROIBIDOS:** `client_ip_address`, `client_user_agent` (são de contexto web/browser). Enviá-los causa rejeição.

### Erros conhecidos da Meta e o que fazer
- **`error_subcode 2804064`** — "Remove argumentos inválidos... client_ip_address client_user_agent". → Remova esses campos do `user_data`.
- **`error_subcode 2804116`** — "page_id ou whatsapp_business_account_id em falta". → O lead está com `page_id` NULL/vazio no banco. **NÃO é bug do payload.**

### Por que o page_id fica NULL (causa raiz já enfrentada)
A URL do anúncio CTWA muitas vezes chega **encurtada** (ex: `fb.me/7327eWL7S`), sem o número que a regex `extrairPageId` (`facebook.com/<num>`) procura. Solução já implementada em 2 camadas:
1. **Leads novos** (`webhook-evo.js`): quando a regex falha, `buscarPageIdViaApi(sourceId, token)` consulta a Graph API (`/<sourceId>?fields=creative{object_story_spec{page_id}}`) e salva o page_id real.
2. **Leads antigos** (`leads-update.js` → `resolvePageId`): usa o `page_id` dominante do próprio cliente como fallback.

### Onde o CTWA chega no payload da Evolution
O `contextInfo` pode vir em **`body.data.contextInfo`** (`msgData.contextInfo`), não só em `message.*`. Campos úteis em `externalAdReply`: `sourceId` (ID do anúncio), `sourceUrl`, `ctwaClid`, `title`, `body`. Sempre checar ambos os caminhos.

### Feedback no painel (front)
O backend retorna `capi: { sent, error }`. O front (`confirmarVenda`/`confirmarQualificacao` em `js/leads.js`) usa `result.capi.sent` para o toast: sucesso (verde), Purchase falho = aviso amarelo (`warning`), Qualified falho = erro. O lead é SEMPRE salvo no banco antes do CAPI — o envio à Meta é passo separado.

## 📊 Carregamento de Leads e Performance do Painel

- **`/api/leads` filtra por período** (`start`/`end` por `created_at`) e usa **lista explícita de colunas** (NÃO `SELECT *`). As colunas TEXT pesadas (`event_source_url`, `anuncio_thumbnail_url`, `token`, etc.) são propositalmente **excluídas** do payload — incluí-las de volta deixa o painel lento (foi a causa de uma lentidão de 24s). Se precisar de um campo novo na tabela/gráficos, adicione-o à lista `COLS` em `api/leads.js`.
- **NÃO existe limite fixo de produto.** O volume é definido pelo período; há só uma guarda de segurança alta (50k). Nunca reintroduza um `LIMIT` baixo que esconda dados — o cliente pode precisar de 1-3 meses.
- **Carregamento inteligente** (`js/leads.js`): o default `hojeOntem` carrega hoje+ontem juntos. Alternar entre `hoje`/`ontem`/`hojeOntem` **refiltra a memória** (instantâneo, sem rede); períodos maiores rebuscam do backend. `window._periodoCarregado` rastreia o que está em `rawData`. Auto-refresh de 30s mantém hoje/ontem frescos.
- **Heatmap, comparativo e relatório consomem `dadosFiltrados`** (recorte de `rawData`). São client-side — refletem o período carregado.
- **Export PDF** (`exportarRelatorioPDF`): força o tema **light** durante a captura (html2canvas) senão o texto do dark mode fica ilegível sobre branco; restaura o dark ao final.

## ⚠️ Inconsistência de STATUS dos leads (ARMADILHA)

A coluna `leads_tracking.status` **não é padronizada** — há grafias misturadas no banco: `novo`, `lead`, `Lead`, `Pendente`, `Vendido`, `Qualificado` (herança de fluxos diferentes: N8N antigo, webhook nativo que insere `'Lead'`, default da coluna).

- **Sempre compare status com `.toLowerCase()`** ao contar/filtrar (ex: `(l.status||'').toLowerCase() === 'vendido'`).
- Venda = status `Vendido`; Qualificado = status `Qualificado` OU `qualified_at` preenchido.
- Ao criar métricas novas por status, considere TODAS as grafias possíveis. Um `COUNT` que assume uma única grafia vai dar número errado.
- Métricas zeradas (0 vendas) podem ser **reais** (cliente sem vendas no período) — confirme no banco com `SELECT status, COUNT(*) ... GROUP BY status` antes de assumir bug.

## 📈 Métricas de Meta Ads — action_types (NÃO SOMAR VARIANTES)

> **A Meta retorna o MESMO evento de compra sob várias variantes de `action_type`** (`omni_purchase`, `purchase`, `offsite_conversion.fb_pixel_purchase`, `onsite_web_purchase`...) que carregam **valor numérico idêntico**. **`omni_purchase` é o roll-up deduplicado** (cobre web+app+loja+offsite). Somar as variantes conta a mesma compra 2-3× → infla Compras/Receita/Checkout e subestima o CPA. Já foi um bug real corrigido.

**Regra:** use **um único action_type canônico** por métrica (o `omni_*`, com fallback no básico). NUNCA some variantes do mesmo evento.

- **Compras (contagem):** `getActFirst(ins, ['omni_purchase','purchase'])`
- **Purchase Value (receita):** `getActValFirst(ins, ['omni_purchase','purchase'])`
- **Initiate Checkout:** `getActFirst(ins, ['omni_initiate_checkout','initiate_checkout'])`
- **ROAS:** ler o campo nativo `purchase_roas` (`action_type === 'omni_purchase'`), ponderado por gasto (`Σ roas×spend / Σ spend`). **Não** calcular manualmente.
- **CPA / custo-por-X:** `spend / metrica` — fica correto automaticamente se a métrica base não estiver inflada.

Helpers `getActFirst`/`getActValFirst` (first-match, sem somar) estão em `js/utils.js`. As métricas de Ads são calculadas em **`index.html`** (painel admin), **`js/share-dash.js`** (dashboard público do cliente) e no backend (`api/cron/send-reports.js`, `api/zap-preview-metrics.js`) — ao mexer numa, alinhe as outras para o número bater nos dois lugares. **Sempre valide contra o Gerenciador de Anúncios da Meta** (a verdade oficial).

### Métricas de vídeo e fórmulas (validadas no SDK oficial da Meta)
- Campos de vídeo vêm como **arrays** `[{action_type, value}]` — extrair com `getVideoVal(ins, campo)` (`js/utils.js`).
- **NÃO existe `video_3_sec_watched_actions`** na API (causa erro #100). O campo de "3 segundos" É o **`video_play_actions`** — a Meta define "reprodução de vídeo" como reprodução de ≥3s. Confirmado no SDK oficial python-business-sdk.
- Campos de vídeo válidos: `video_p25/p50/p75/p100_watched_actions`, `video_play_actions`, `video_thruplay_watched_actions` (15s+), `video_6_sec_watched_actions`, `video_15/30_sec_watched_actions`, `video_avg_time_watched_actions`.
- **Hook Rate / Taxa de Gancho: REMOVIDO.** A API NÃO expõe "reproduções de 3 segundos" (o numerador que o Gerenciador usa). Debug com dados reais confirmou: `video_play_actions` não é o de 3s (112 plays mas só 4 chegaram a p25), e `video_3_sec_watched_actions` não existe (#100). Qualquer fórmula seria aproximação enganosa → card removido. Se precisar no futuro, validar o numerador real no Gerenciador vs. campos da API antes.
- **Connect Rate** = `landing_page_view / inline_link_clicks × 100` (visualizações da página ÷ cliques no link).
- **Visualizações 25/50/75/100%** = **número absoluto** (`video_pXX` direto via `fmtN`), NÃO taxa — é contagem de reproduções como no Gerenciador. Custo = `spend / video_pXX`.

### ⚠️ Campos que a Meta pode rejeitar (#100)
A Meta rejeita a **query inteira** se um único campo do `insightFields` for inválido. Antes de adicionar campo novo, confira a lista válida no SDK oficial (`facebook-python-business-sdk/.../adsinsights.py`) — não confie em blogs (dão nomes errados). O `ads.js` usa Graph API **v23.0** (CAPI usa v25; demais endpoints de Ads ainda v20). NUNCA adicione um campo não verificado direto na string — quebra todo o painel de Ads.

### 🎯 Metodologia para validar QUALQUER métrica nova de Ads (lição da saga do Hook Rate)
Doc oficial, blogs e SDK deram informações **conflitantes** sobre o campo de 3s — e todos estavam parcialmente errados. O que resolveu foi **testar com dados reais da conta**:
1. **Nunca confie só na doc/blog para o nome do campo nem para a fórmula.** Eles divergem.
2. **Use um card de DEBUG temporário** que mostra os campos crus + várias razões calculadas, e **compare com o número exato do Gerenciador de Anúncios** (a única verdade). Foi assim que descobrimos que `video_play_actions` ≠ "3 segundos".
3. **Se a API não entrega o dado que o Gerenciador usa, NÃO invente uma fórmula aproximada** — remova a métrica (como fizemos com o Hook Rate). Métrica errada para o cliente é pior que métrica ausente.
4. Sempre validar o número final do painel contra o Gerenciador antes de considerar a métrica pronta.

### Drill-down de campanhas (cards seguem o foco)
No painel de Ads, focar numa campanha (`focarLinha`) recalcula os **cards do topo** só para ela, via `recalcMetricasFoco()` (`index.html`). Voltar para "Todas" (`voltarFoco`) recalcula o total filtrado. Só mexe nos cards, não na tabela. Ao mexer no drill-down, manter essa chamada nos dois pontos.

## 📑 Relatórios — comparativo, PDF e métricas

- **Comparativo vs período anterior:** cada card de métrica mostra a variação +/-% contra o período anterior de mesma duração (`renderComparativoPeriodo` em `js/leads.js`). Busca leve via `/api/leads` com range deslocado; `calcMetricasRelatorio` é reusado para os dois períodos. Herda o limite do endpoint — é tendência, não número exato absoluto.
- **Export PDF** (`exportarRelatorioPDF`): html2canvas + jsPDF (CDN com `defer`). **Força tema light** durante a captura (senão o dark mode dá texto ilegível) e restaura depois; fatia em múltiplas páginas se preciso.
- **Card "Qualificados":** conta `status === 'qualificado'` OU `qualified_at` preenchido (estava hardcoded em 0 antes).
- **Ciclo médio** (`metrics-temporal.js` → `formatCycle`): unidade adaptável — min (<1h), horas (<1 dia), dias. Vendas no mesmo dia davam "0.0 dias"; agora mostra "42 min".
- **Heatmap** (`renderHeatmap` em `js/leads.js`): cada célula com leads mostra o **número no centro** (cor do texto adapta ao fundo). É client-side sobre `dadosFiltrados`.

## 🎨 Padrão visual e nomenclatura do menu (NÃO reverter)

- **Sem banners/gradientes chamativos.** Headers de aba seguem o padrão: `<i data-lucide=icone style=color:var(--blue)> Título` + `<p style=color:var(--muted)>descrição`. O header gradiente da Personalização da Marca foi removido por destoar.
- **Cards de métrica** usam sombra suave (`rgba(0,0,0,0.05)`), não a sombra preta forte do tema escuro.
- **Nomes do menu (atuais):** "Leads" (era "Leads Reais"), "Contas de Anúncio" (era "Integrações" — só configura contas, não integrações genéricas), "Relatórios Automáticos" (era "Relatórios Zap"), "Conexão WhatsApp" (sem "SaaS"). Ao mexer, manter menu ↔ `TITULOS` ↔ permissões (`permX`) consistentes.
- **Abas só-admin:** `btn-agencia` (Gestão de Clientes) e `btn-ajustes` (Configurações/white-label) têm `display:none` no HTML e só aparecem via JS para `is_admin` — **é intencional, não bug**.

## Atualizacao recente - Organizacao das metricas de Ads

Foi implementada uma organizacao estilo Meta/Facebook para o painel de metricas de Ads no dashboard principal.

Arquivos principais:
- `index.html`: contem a definicao das metricas, categorias, presets, modal de personalizacao, estado salvo e renderizacao das colunas/cards.
- `css/dashboard.css`: contem o acabamento visual do toolbar, modal, categorias, chips de presets e lista de metricas selecionadas.

O que mudou:
- O antigo painel aberto de checkboxes foi substituido por um botao **Personalizar metricas** e um seletor de **Visao**.
- Existem presets prontos em `METRIC_PRESETS`: `overview`, `whatsapp`, `traffic`, `instagram`, `sales`, `video`, `engagement`, `social`, `efficiency`.
- As metricas sao agrupadas por categorias em `METRIC_CATEGORY_LABELS`/`METRIC_META`: Investimento, Entrega, Trafego, Leads/WhatsApp, Instagram, Vendas, Video, Engajamento e Social.
- `COLS_DEF` agora deriva de `CARDS_DEF`, entao as 46 metricas disponiveis nos cards tambem podem ser usadas na tabela.
- A configuracao continua salva em `localStorage` pela chave `wt_metrics_cfg`, agora com `cards`, `colsOrder` e `preset`.
- O modal tem abas para **Cards** e **Tabela**, busca, chips de presets, lista de selecionadas e ordenacao manual das colunas da tabela.
- A tabela usa `getAdsMetricCellValue(key, ins)` para centralizar o valor de cada metrica, inclusive video, engajamento, social, compras, ROAS e custos.

Cuidados ao mexer:
- Nao voltar para listas separadas e divergentes de cards/colunas; a ideia agora e manter `COLS_DEF` sincronizado com `CARDS_DEF`.
- Ao adicionar uma metrica nova, incluir em `CARDS_DEF`, mapear categoria em `METRIC_META` e implementar o retorno em `getAdsMetricCellValue`.
- Para compras/valor/checkout, continuar usando `getActFirst`/`getActValFirst` com `omni_*` como canonico para nao duplicar eventos da Meta.
- Para video, usar `getVideoVal` de `js/utils.js`.

Validacoes feitas antes do deploy:
- Parse dos scripts inline do `index.html` com `node/vm`: OK (`checked 11 inline script(s)`).
- `node --check server.js`: OK.
- `git diff --check`: OK.
- App local respondeu `200` em `/` e `/health`; `/health` retornou `{"status":"ok"}`.

Commits enviados para `main`:
- `2f1cb4a feat: organizar metricas de ads`
- `5193c05 chore: ignorar arquivos locais no deploy`

Deploy:
- Push para `origin/main` concluido; este e o fluxo esperado para o EasyPanel segundo o README.
- Tentativa de deploy direto pela Vercel CLI falhou porque o projeto possui mais de 12 Serverless Functions, limite do plano Hobby. Este repo e mais adequado ao fluxo EasyPanel/Nixpacks rodando `node server.js`.
- Foi criado `.vercelignore` para evitar enviar `.env`, `.claude`, `.git`, `node_modules` e `.vercel` caso alguem tente deploy direto pela Vercel novamente.

## Atualizacao recente - Menu, CAPI, ciclo e busca de leads

Esta secao prevalece sobre qualquer nota antiga de menu neste arquivo.

Mudancas recentes ja enviadas para `main`:
- `57ecf6c refactor: reorganiza menu, move Contas de Anuncio p/ modal em Meta Ads, corrige CAPI e ciclo`
- `8dba315 fix: desativa autofill na busca de leads`

O que ficou definido:
- O separador "Configuracao" foi renomeado para "Conta"; ele abriga "Minha Conta" e "Compartilhar Dash".
- A antiga aba lateral "Contas de Anuncio" foi removida do menu; a gestao de contas agora abre pelo botao "Gerenciar contas" na barra de Meta Ads, mantendo o usuario no contexto dos anuncios.
- `api/webhook-evo.js`: `LeadSubmitted` nao deve enviar `client_ip_address` nem `client_user_agent` quando `action_source` for `business_messaging`; esses campos sao proibidos pela Meta nesse canal.
- `api/metrics-temporal.js`: metricas de ciclo medio e vendas rapidas usam `sale_closed_at` como filtro do periodo. Metricas de lead, como leads esquecidos e resposta media, continuam usando `created_at`.
- `index.html`: o campo `inputBusca` da barra de leads deve manter `autocomplete="off"` e `name="lead_search"` para evitar que Chrome/Edge preencham automaticamente e-mail salvo no campo de busca.

## 🎯 Enriquecimento de UTMs e Origem dos Leads (2026-06-17)

### Como os dados de campanha chegam
Os leads CTWA chegam pelo webhook com `source_id` (ID do anúncio na Meta) mas **sem** campanha/conjunto/anúncio. O sistema faz uma requisição à Graph API para buscar esses dados.

### Implementação atual (`api/webhook-evo.js`)
A função `buscarInfoAnuncio(sourceId, token)` faz uma única chamada:
```
GET /v25.0/{sourceId}?fields=name,campaign_id,campaign{name},adset_id,adset{name},creative{id,name,object_story_spec{page_id}}
```
Retorna e salva no INSERT: `utm_campaign` (campanha), `utm_medium` (conjunto), `utm_content` (anúncio), `page_id`.

**ATENÇÃO:** o campo `effective_object_story_id` é INVÁLIDO na v25 (erro #100) — nunca usar.

### Token necessário
O token do **cliente** (`token_meta_enc`) é obrigatório — o token global do `.env` (`META_ADS_TOKEN`) é da agência e não tem acesso ao pixel/anúncios de cada cliente para CAPI e Graph API de anúncios específicos.

### Criptografia dos tokens
- Algoritmo: **AES-256-GCM** (não CBC). Formato do buffer: `[IV(12b) + Tag(16b) + Cifra]`
- Implementação canônica em `api/_crypto.js` — sempre usar `encryptToken`/`decryptToken` deste arquivo
- Scripts em `scripts/` devem replicar o mesmo algoritmo GCM, nunca CBC

### Script retroativo de enriquecimento
`scripts/enrich-leads-utm.js` — popula UTMs em leads antigos via Graph API.
```bash
ENRICH_INSTANCIA=nome-instancia ENRICH_DAYS=365 ENRICH_DRY_RUN=true node -r dotenv/config scripts/enrich-leads-utm.js
```
- Filtra por instância e período
- Dry run mostra o que faria sem gravar
- Leads sem `source_id` ou onde a Meta retorna "Unsupported get request" ficam sem UTM (sem solução)

### Migração de tokens legados
`scripts/migrate-tokens.js` — migra `token_meta` (texto puro) para `token_meta_enc` (criptografado).
```bash
node -r dotenv/config scripts/migrate-tokens.js
```
Após migrar, limpar o campo legado: `UPDATE clientes SET token_meta = NULL;`

### Exibição no painel
- **Tabela de Leads**: coluna "Campanha / Anúncio" mostra campanha (negrito), conjunto (roxo `#6366f1`) e anúncio (cinza)
- **Relatórios**: gráficos "Campanhas / Leads" e "Conjuntos / Leads" agrupam por `utm_campaign` e `utm_medium`
- `api/leads.js` COLS deve incluir `utm_campaign`, `utm_medium`, `utm_content` — se faltar algum, o front não recebe o dado mesmo que esteja no banco

## ⏱️ Primeira Resposta da Empresa (`first_response_at`) — fromMe

O webhook (`api/webhook-evo.js`) **captura o momento em que a empresa responde** o lead. Antes, mensagens `fromMe: true` eram ignoradas e `first_response_at` ficava sempre NULL (card "Resposta Média" mostrava 0).

### Como funciona agora
Quando chega `key.fromMe === true`, o webhook NÃO cria lead — ele faz `UPDATE leads_tracking SET first_response_at = NOW()` no **lead mais recente daquele telefone que ainda está com `first_response_at` NULL**. A métrica "Resposta Média" = `AVG(first_response_at - created_at)` passa a funcionar.

### ⚠️ ARMADILHA: a variável `instance` não existe no bloco fromMe
O bloco `fromMe` roda **antes** da declaração de `instance` (que só acontece mais abaixo, na etapa 8). Por isso o bloco extrai a instância localmente como **`instanceFm`** (`body.instance || body.instanceName || ...`). NUNCA usar `instance` dentro do bloco fromMe — causa `ReferenceError` e derruba o webhook para toda mensagem enviada (bug já corrigido uma vez no commit `f017d31`).

### ⚠️ PONTO DE ATENÇÃO: bot/saudação automática infla a métrica
As instâncias têm **saudação automática/bot** antes do atendente humano. A Evolution **não fornece flag nativa** para distinguir bot de humano — ambos chegam como `fromMe: true`. Logo, `first_response_at` pode marcar o tempo do BOT (quase instantâneo), não do humano. Se a "Resposta Média" aparecer muito baixa (ex: segundos), é o bot. Refinamento futuro (não implementado): filtrar por texto fixo da saudação OU por heurística de tempo (ignorar respostas em < N segundos). Decisão pendente do cliente.

## 🔧 Script `fix-page-id.js` — corrige page_id + reenvia CAPI

`scripts/fix-page-id.js` — para leads com `page_id IS NULL` mas `source_id` preenchido:
1. Busca `page_id` na Graph API (`/{sourceId}?fields=creative{object_story_spec{page_id}}`)
2. Faz `UPDATE` no banco
3. **Reenvia o evento `LeadSubmitted` para o CAPI** com o page_id correto (mesmo payload do `sendCapiLead`)

```bash
FIX_INSTANCIA=nome-instancia FIX_DAYS=10 FIX_DRY_RUN=true node -r dotenv/config scripts/fix-page-id.js
```
- Usa AES-256-GCM (igual `api/_crypto.js`), cache de token+pixel por cliente
- "page_id não retornado" = anúncio deletado/sem permissão → sem solução
- Já rodado: ~90 eventos LeadSubmitted reenviados (reidosofa, reidoscolchoes)

### Log de page_id NULL no webhook
O webhook agora grava em `webhook_logs` (tag `page_id_missing`) quando o page_id fica NULL — distingue "cliente sem token" de "Graph API não retornou". Visível na aba **Logs do Sistema**.

## 👤 Drawer de Perfil do Lead (4 abas)

Botão de perfil (ícone `user` roxo) em cada linha da tabela de leads abre um drawer lateral (`#leadProfileDrawer` no final do `<body>` do `index.html`). Endpoint: `api/lead-profile.js` (`GET /api/lead-profile?id=<leadId>`) retorna `{ lead, jornada }` — `jornada` = todos os registros do mesmo telefone+cliente ordenados por data.

- **4 abas:** Perfil (dados pessoais + atendimento + 1ª mensagem), Anúncio (campanha/conjunto/anúncio + rastreamento), Jornada (timeline de todos os contatos via anúncio, com qual ad trouxe em cada vez), Venda (tempo até 1ª resposta, ciclo, valor, produto).
- Lógica JS em `js/leads.js`: `abrirPerfilLead(leadId)`, `lpMudarTab(tab)`, `lpPreencherDados()`.
- O drawer **deve ficar no final do `<body>`** (não dentro de container com `overflow:hidden`) senão o overlay escuro não cobre a tela.
