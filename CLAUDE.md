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
- 3 camadas de fallback de page_id (ver abaixo)
- Já rodado: ~90+ eventos LeadSubmitted reenviados (reidosofa, reidoscolchoes, tayna)

### Log de page_id NULL no webhook
O webhook agora grava em `webhook_logs` (tag `page_id_missing`) quando o page_id fica NULL — distingue "cliente sem token" de "Graph API não retornou". Visível na aba **Logs do Sistema**.

## 🎯 As 3 fontes de page_id (ORDEM DE FALLBACK) — IMPORTANTE

O `page_id` é o ID da **página do FB/IG** — normalmente **o mesmo em TODOS os anúncios de um cliente** (validado: reidoscolchoes tem 478 leads no mesmo `992303220626755`). Tanto `buscarInfoAnuncio` (webhook) quanto `fetchPageId` (`scripts/fix-page-id.js`) resolvem o page_id nesta ordem:

1. **`creative.object_story_spec.page_id`** — funciona para anúncios "post da página" (maioria).
2. **`tracking_specs[].page`** (método herdado do N8N) — para anúncios **dynamic/catálogo** que NÃO têm `object_story_spec` (Meta retorna erro #100 `Tried accessing nonexisting field (object_story_spec)`). Busca recursiva pela chave `page` no array `tracking_specs`. **Foi o que resolveu a Tayna** — confirmado com `scripts/teste-tracking-specs.js` (compara os 2 métodos com source_id real).
3. **page_id dominante do cliente** (`resolvePageId` em `leads-update.js`; `getPageIdDominante` no script) — o `page_id` mais frequente dos outros leads do mesmo cliente. Cobre leads **sem source_id** (só têm ctwa_clid).

**Para cliente NOVO sem nenhum page_id no banco** (fallback 3 não tem de onde copiar): descobrir a página real com `scripts/listar-pages-cliente.js` (`/me/accounts` + testa source_id real mostrando todos os caminhos). Depois forçar via `FIX_PAGEID=<id>` no `fix-page-id.js`. Ex: Tayna = `163794940158656`.

> A única chamada do webhook agora pede `...,tracking_specs,creative{...object_story_spec{page_id}}` — uma requisição traz UTMs + ambos os caminhos de page_id.

## 🌐 Resiliência de rede no painel (auto-refresh)

- **Auto-refresh de leads (30s, `index.html`):** só dispara `recarregarLeads(true)` se `!document.hidden` E `navigator.onLine !== false`. Sem essas guardas, o refresh rodava offline/em background e empilhava `ERR_INTERNET_DISCONNECTED` no console. Em queda de rede, o indicador mostra **"sem conexão"** (amber), não "erro ao carregar" + toast.
- **`authFetch` tem timeout de 30s** (AbortController). Sem ele, uma requisição que cai no meio fica pendurada para sempre → `recarregarLeads` nunca chega ao `finally` → o spinner "Atualizar" **gira eternamente**. O timeout aborta e libera. Respeita `signal` externo se já houver (ex: `authFetchJsonTimeout`).

## 👤 Drawer de Perfil do Lead (4 abas)

Botão de perfil (ícone `user` roxo) em cada linha da tabela de leads abre um drawer lateral (`#leadProfileDrawer` no final do `<body>` do `index.html`). Endpoint: `api/lead-profile.js` (`GET /api/lead-profile?id=<leadId>`) retorna `{ lead, jornada }` — `jornada` = todos os registros do mesmo telefone+cliente ordenados por data.

- **4 abas:** Perfil (dados pessoais + atendimento + 1ª mensagem), Anúncio (campanha/conjunto/anúncio + rastreamento), Jornada (timeline de todos os contatos via anúncio, com qual ad trouxe em cada vez), Venda (tempo até 1ª resposta, ciclo, valor, produto).
- Lógica JS em `js/leads.js`: `abrirPerfilLead(leadId)`, `lpMudarTab(tab)`, `lpPreencherDados()`.
- O drawer **deve ficar no final do `<body>`** (não dentro de container com `overflow:hidden`) senão o overlay escuro não cobre a tela.

## Correção de 502 em Leads e Métricas Temporais (2026-06-18)

### Sintoma observado
- `/api/leads` e `/api/metrics-temporal` responderam `502 Bad Gateway`.
- O proxy devolveu uma página HTML de erro, e `js/leads.js` tentou executar `response.json()`, gerando também `Unexpected token '<'`.

### Diagnóstico realizado
- As colunas `created_at`, `first_response_at`, `sale_closed_at`, `last_interaction_at` e `utm_medium` existem em `leads_tracking`.
- Os índices principais existem, incluindo `idx_leads_cliente_data (cliente_id, created_at DESC)`.
- O banco tinha cerca de 3,3 mil leads no total e somente 121 registros nos últimos dois dias; portanto, o 502 não foi causado por excesso de volume.
- O endpoint `/health` voltou a responder `200`, indicando uma falha transitória do processo/container ou da conexão com o PostgreSQL.
- Causa provável: uma conexão ociosa do pool sendo derrubada pelo banco/rede. Sem listener para o evento `error` do `pg.Pool`, esse cenário pode encerrar o processo Node e fazer o proxy responder 502.

### Correção aplicada
- `api/_db.js`:
  - habilita TCP keepalive;
  - registra `pool.on('error', ...)`, evitando que a perda de uma conexão ociosa derrube o processo Node.
- `index.html`:
  - adiciona `readApiJson()`, que valida status e `Content-Type` antes de interpretar a resposta como JSON.
- `js/leads.js`:
  - `/api/leads` e `/api/metrics-temporal` usam `readApiJson()`;
  - uma página HTML de 502 agora gera uma mensagem HTTP legível, sem o erro enganoso `Unexpected token '<'`.

### Validação e publicação
- `node --check api/_db.js`: aprovado.
- `node --check js/leads.js`: aprovado.
- Scripts inline de `index.html`: sintaxe aprovada.
- `git diff --check`: aprovado.
- Commit publicado: `838bc33 fix: evita 502 ao perder conexão com banco`.
- O commit foi enviado para `origin/main` e continua presente no histórico do remoto.
- Na última verificação logo após o push, o domínio ainda servia o `index.html` anterior, embora `/health` respondesse `200`. Portanto, o push ao GitHub foi confirmado, mas a conclusão do redeploy automático do EasyPanel não foi comprovada naquele momento.

## Captação Orgânica + Links Rastreáveis + Rotador (2026-06-19)

### Fase 1 — captura configurável por instância
- O webhook continua com `ctwa_only` como padrão seguro.
- Cada instância pode usar:
  - `ctwa_only`: somente leads com `ctwaClid`;
  - `all`: todos os novos contatos;
  - `keyword`: somente mensagens que correspondam às palavras configuradas.
- A configuração fica em `lead_capture_settings` e é editada pelo botão **Captura** na aba Conexão WhatsApp.
- Leads sem anúncio recebem `lead_origin = organic`.
- CAPI `LeadSubmitted` continua exclusivo para CTWA; lead orgânico não é enviado à Meta.

### Fase 2 — links, token invisível e rotador
- Nova aba **Captação e Links**:
  - cria links públicos `/r/<slug>`;
  - suporta destino único, round-robin, peso e prioridade;
  - registra cliques, UTMs, referrer, IP e User-Agent;
  - mostra cliques, conversões, leads e taxa de conversão.
- O redirecionador público está em `api/redirect.js`.
- A seleção transacional dos números está em `api/_rotator.js`.
- O protocolo zero-width com versão e checksum está em `api/_invisible-token.js`.
- O token é colocado no início da mensagem pré-preenchida e removido antes de gravar a mensagem no CRM.

### Regras de atribuição
- O webhook só força a captura de um link quando o token invisível:
  - decodifica corretamente;
  - existe em `tracking_clicks`;
  - pertence ao mesmo cliente;
  - ainda está pendente e dentro da validade;
  - pertence a uma campanha ativa.
- A atribuição principal continua sendo pelo token exato. Se o WhatsApp remover o token inteiro, existe fallback restrito: somente um único clique pendente da mesma instância nos últimos 5 minutos pode ser correlacionado. Havendo mais de um candidato, nenhuma campanha é atribuída automaticamente.
- Origens possíveis: `ctwa`, `organic`, `bio`, `campaign_link` e `rotator`.
- Um clique só pode ser associado a um lead, protegido por status transacional e índice único em `leads_tracking.tracking_click_id`.
- Cada destino do rotador deve estar vinculado a uma instância Evolution do mesmo cliente.
- O clique grava `instance_name`, e o webhook só aceita/converte o token quando a mensagem retorna pela mesma instância escolhida no redirecionamento.
- Instâncias novas passam a ser registradas automaticamente em `instancias_mapeamento`.
- Campanhas antigas sem vínculo exibem um seletor de instância em cada linha de destino; não é necessário apagar e recriar os números.
- `js/captacao.js` usa versão na URL para evitar que o navegador mantenha o formulário antigo em cache após o deploy.
- O decodificador aceita o token mesmo quando o WhatsApp remove apenas os marcadores `U+2060` e preserva os bits `U+200B/U+200C`.
- Se o token inteiro desaparecer, o webhook pode correlacionar um único clique pendente da mesma instância nos últimos 5 minutos (`recent_click_correlation`). Se houver mais de um candidato, não atribui automaticamente e registra `tracking_fallback` nos Logs do Sistema.
- Os filtros de Logs do Sistema incluem `tracking_token`, `tracking_fallback` e `tracking_ignored` para diagnosticar o caminho real de cada teste.
- O fluxo de links salva `utm_content` em `tracking_campaigns`/`tracking_clicks` e copia o valor para `leads_tracking.utm_content`, onde o front exibe o nome do anúncio.

### UTMs da Meta
- O redirecionador lê diretamente da URL: `utm_source`, `utm_medium`, `utm_campaign` e `utm_content`.
- Os valores recebidos na URL têm prioridade sobre os valores padrão cadastrados no formulário do link.
- Para parâmetros dinâmicos da Meta, usar:
  `utm_source={{site_source_name}}&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`.
- Não é necessário PageView para capturar as UTMs; elas são gravadas no servidor no momento do clique.
- A mensagem pré-preenchida aceita variáveis dinâmicas: `{{utm_content}}`, `{{utm_campaign}}`, `{{utm_medium}}` e `{{utm_source}}`. O redirecionador substitui os valores no clique antes de abrir o WhatsApp; assim cada anúncio pode incluir seu próprio nome na mensagem.

### CAPI Web e PageView do link
- Credenciais dedicadas por cliente:
  - `clientes.capi_pixel_id`;
  - `clientes.capi_token_enc`;
  - `clientes.capi_token_last4`;
  - `clientes.capi_token_updated_at`.
- `api/_capi-web.js` envia eventos web para a Meta usando essas credenciais, sem reutilizar o token da CAPI de WhatsApp.
- Ao abrir `/r/<slug>`, o sistema:
  1. grava o clique e as UTMs em `tracking_clicks`;
  2. gera `pageview_event_id`;
  3. envia `PageView` pela CAPI server-side;
  4. serve uma página intermediária curta com Pixel JS;
  5. dispara o mesmo `PageView` no navegador com o mesmo `event_id`;
  6. redireciona para o WhatsApp após aproximadamente 1,4 segundo.
- O mesmo `event_id` no Pixel e na CAPI permite a deduplicação pela Meta.
- Sem Pixel/CAPI Web configurado, o redirecionamento continua funcionando com atraso mínimo e sem bloquear o clique.
- Quando o clique vira lead, `api/webhook-evo.js` envia também o evento web `Lead`, associado ao clique rastreável.

### Script para site externo (`js/wapptrack.js`)
- Fluxo validado em producao no site `https://www.frigorificooeron.com.br/#localizacao`:
  1. o HTML carrega `<script src="https://adlyticspro.workidigital.tech/js/wapptrack.js" data-campaign="220e0098-3534-4e3c-bc23-9f5265feac1f"></script>`;
  2. `/api/site-pageview` registra PageView e devolve `visitor_id`, `pageview_event_id`, `pixel_id` e `button_text`;
  3. `/api/site-whatsapp-click` gera `tracking_id`, grava `tracking_clicks` com `source='site'` e devolve a URL final do WhatsApp com token invisivel;
  4. a conversao continua no `api/webhook-evo.js`, quando a mensagem chega com o token.
- Todo botao do site externo que deve abrir WhatsApp precisa ter `data-wapptrack-button`. Se o botao tiver icone + texto, marcar o texto com `data-wapptrack-label` para o texto configurado (`tracking_campaigns.button_text`) trocar so o label.
- Exemplo React correto:
  ```jsx
  <button type="button" data-wapptrack-button>
    <WhatsAppIcon />
    <span data-wapptrack-label>Falar no WhatsApp</span>
  </button>
  ```
- Nao usar link fixo `wa.me`/`api.whatsapp.com` nesses botoes quando o objetivo for rastrear. O script precisa interceptar o clique para chamar `/api/site-whatsapp-click`.
- Em sites React/lazy/scroll, botoes renderizados depois do carregamento inicial podem ficar sem listener. Depois de renderizar componentes tardios, chamar `window.wapptrackRefresh?.()`. Alternativa mais robusta: evoluir `js/wapptrack.js` com `MutationObserver` para religar botoes adicionados dinamicamente.
- No teste do Frigorifico O Eron, a API estava OK; o problema era front: botoes como menu, flutuante e rodape eram `<button>` sem `href`, sem `onClick` e sem `data-wapptrack-button`. A correcao foi marcar todos eles.
- Se a mensagem do WhatsApp sair com prefixo estranho como `[] Opa...`, isso vem do texto configurado da campanha (`default_message`), nao do redirect. Limpar a mensagem no painel.

### Logs do rastreamento
- O redirecionador grava diagnósticos em `webhook_logs`, visíveis na aba **Logs do Sistema**:
  - `tracking_click`: clique, campanha, destino, presença de `fbclid`/`fbc`/`fbp` e configuração de pixel;
  - `capi_web`: sucesso ou falha do PageView/Lead enviado pela CAPI Web;
  - `tracking_token`: token recebido sem clique pendente compatível;
  - `tracking_fallback`: correlação recente utilizada ou ambígua;
  - `tracking_ignored`: mensagem sem token válido e fora do modo de captura.

### Interface de links
- A tabela da aba **Captação e Links** foi compactada:
  - nome, URL e botão de copiar ficam na mesma linha;
  - modo, cliques, conversões e status ficam centralizados;
  - pausar, editar e excluir ficam lado a lado;
  - telas menores usam rolagem horizontal para preservar os controles.
- O número do destino é obtido da instância conectada e não deve ser digitado manualmente.

### Banco e ativação em produção
As novas tabelas/colunas são criadas por `setup-db.js`:
- `lead_capture_settings`
- `tracking_campaigns`
- `tracking_destinations`
- `tracking_clicks`
- campos de origem e tracking em `leads_tracking`

O EasyPanel executa apenas `node server.js`. Portanto, antes de usar a funcionalidade em produção, executar uma vez no terminal do serviço:

```bash
node setup-db.js
```

Depois confirmar nos logs as mensagens de criação das tabelas Fase 1/Fase 2.

`api/leads.js` e `api/lead-profile.js` possuem fallback temporário para o formato anterior caso o código reinicie antes da migração. Isso evita derrubar a tela principal, mas a aba Captação e Links só funciona depois da criação das tabelas.

### Bootstrap automático do schema
Após um terminal do EasyPanel executar uma versão antiga de `setup-db.js`, as APIs novas retornaram `500` por ausência das tabelas. Para não depender mais da ordem manual deploy → terminal → migração:

- `api/_tracking-schema.js` garante o schema na primeira chamada;
- usa `pg_advisory_xact_lock` para impedir migrações concorrentes entre containers;
- é idempotente (`IF NOT EXISTS`);
- é chamado pelas APIs de campanhas, métricas, captura, redirecionamento e webhook;
- se a primeira tentativa falhar, a promise é liberada para permitir nova tentativa.

`node setup-db.js` continua válido para preparação explícita, mas não é mais obrigatório para recuperar um deploy novo.

### Validações concluídas
- Sintaxe Node aprovada em backend, frontend e `setup-db.js`.
- Round-trip do token através de `encodeURIComponent`/`decodeURIComponent` aprovado.
- Checksum rejeita token corrompido.
- Rotador `single` e `round_robin` aprovados em teste isolado.
- Página, CSS e `js/captacao.js` respondem `200` no servidor local.
- Modal validado por DOM simulado: abertura, geração de slug e adição de destino.
- Vínculo destino ↔ instância validado no frontend, backend, clique e webhook.
- Token validado com e sem os marcadores `U+2060`.
- `utm_content` validado no fluxo campanha → clique → lead → frontend.
- Layout compacto da tabela validado no HTML gerado.
- Produção verificada com `/health` respondendo `200`.
- Produção confirmada com seletor de instância, UTM Content e tabela compacta publicados.

### Validações manuais recomendadas
- Criar um clique novo e enviar a mensagem em até 5 minutos usando a instância vinculada.
- Conferir em `tracking_clicks` se `status` muda de `clicked` para `converted`.
- Conferir em `leads_tracking` os campos `tracking_click_id`, `tracking_campaign_id`, `tracking_method` e as quatro UTMs.
- Confirmar a preservação do token e o fallback em:
  - WhatsApp Android;
  - WhatsApp iOS;
  - WhatsApp Web.
- Conferir no Gerenciador de Eventos da Meta se Pixel e CAPI receberam o PageView com deduplicação.

## 🔗 Atribuição de Link Rastreável — 3 armadilhas resolvidas (2026-06-20)

Saga de debug que custou caro. Um lead de link `/r/<slug>` no **iPhone** não era capturado / vinha
órfão. Três causas-raiz independentes, todas em `api/webhook-evo.js` + `api/_tracking-schema.js`.
Validado de ponta a ponta (lead 3496 nasceu `campaign_link` + `recent_click` + vínculo completo).

### 1. iPhone REMOVE o token invisível → fallback de clique recente é OBRIGATÓRIO
O WhatsApp do iPhone apaga os zero-width do token. Sem fallback, o lead cai no `capture_mode` da
instância. A correlação por tempo já tinha sido **removida** uma vez (medo de roubar atribuição) — e
isso quebrou 100% dos links no iPhone. **Reintroduzida com regra estrita:** só atribui se houver
**EXATAMENTE 1 clique pendente** (`status='clicked'`, `converted_at IS NULL`) da **mesma instância**
nos **últimos 10 min**. 2+ candidatos = ambíguo → NÃO atribui (loga `tracking_fallback`). `tracking_method='recent_click'`.
> ⚠️ NUNCA remover esse fallback de novo sem uma identidade alternativa — é a única âncora no iPhone.

### 2. Lead de link DEVE bypassar o `capture_mode` da instância
Quando o fallback (ou token) acha o clique, `trackedClick` é setado → o lead vira `campaign_link` e
**pula** o bloco que checa `ctwa_only`/`keyword`/`all`. Sem isso, um clique LEGÍTIMO no link era
descartado (`tracking_ignored`) só porque a instância de destino estava em `keyword`/`ctwa_only`.
Um clique real no link rastreável captura SEMPRE, independente do modo de captura.

### 3. Vínculo clique↔lead tem que ser ATÔMICO (e `tracking_method` cabe em VARCHAR(40))
Antes, o vínculo era gravado em 2 UPDATEs autocommit soltos: o do **clique** (`lead_id`, `converted`)
e o do **lead** (`tracking_click_id`, UTMs). O do lead falhava silenciosamente quando
`tracking_method='recent_click_correlation'` (24 chars) estourava a coluna **`VARCHAR(20)`** →
`value too long for type character varying(20)` engolido → **lead órfão** (`campaign_link` com
`tracking_click_id` NULL). Correções: (a) os dois lados gravam na **mesma transação**
(`pool.connect()`+BEGIN/COMMIT/ROLLBACK) em `atribuirClique`; (b) valor curto `'recent_click'`;
(c) coluna ampliada para `VARCHAR(40)` em `_tracking-schema.js` (`ALTER COLUMN ... TYPE`, idempotente).
O disparo do CAPI Web Lead fica FORA da transação (best-effort, pós-COMMIT).

### Diagnóstico (sempre fazer assim)
Os logs em `webhook_logs` (aba Logs do Sistema) contam a história. Tags úteis: `tracking_token`
(token reconhecido), `tracking_fallback` (correlação por tempo: sucesso ou ambígua), `tracking_ignored`
(descartado pelo modo — checar `capture_mode` e `token_detectado` no `data`). Cruzar o horário do log
com `created_at` do lead e `converted_at`/`lead_id` do clique fecha qualquer caso.

### Limitação conhecida (trade-off aceito)
Em produção com **muitos cliques simultâneos** na mesma instância, o fallback fica ambíguo (2+
pendentes) e o lead de iPhone pode não receber campanha (cai no modo da instância). É proposital
(não roubar atribuição). Evolução futura: identidade visível mais robusta (nº de destino por campanha,
sufixo na mensagem). Commits da saga: `2f62996`, `c883e46`, `8c13820`.

## 🗑️ Confirmação de exclusão de leads (2026-06-20)

A exclusão de leads **não deve usar `window.confirm()` / `confirm()` nativo do navegador**. O alerta
com o texto “o domínio diz” não segue a identidade visual do sistema e oferece pouca clareza para
ações destrutivas.

Implementação atual:

- modal próprio `#modalExcluirLeads` em `index.html`;
- abertura por `excluirLeadsSelecionados()` em `js/leads.js`;
- confirmação efetiva por `confirmarExclusaoLeads()`;
- fechamento/cancelamento por `fecharModalExcluirLeads()`;
- texto e título adaptados para um lead ou vários leads selecionados;
- botão de confirmação mostra `Excluindo...` e fica desabilitado durante a operação;
- exclusão em lotes de até 500 IDs e chamada a `/api/leads-delete` foram preservadas.

> Regra de UI: futuras confirmações destrutivas na área de leads devem reutilizar um modal interno,
> nunca reintroduzir `confirm()` nativo. Publicado em produção no commit `8786267`.

A mesma regra vale para **toda ação destrutiva do painel**, não apenas leads. Em especial, arquivar
links em `js/captacao.js` usa `#modalArquivarLink` + `capConfirmarArquivamento()`; nunca usar
`confirm()` nativo, que mostra “o domínio diz” e quebra a identidade visual do produto.

## 🕵️ Token invisível no iPhone — a fórmula que FUNCIONA (2026-06-21)

O token invisível (`api/_invisible-token.js`) embute o `tracking_id` em caracteres invisíveis no
início da mensagem do WhatsApp. No **iPhone** ele sumia/ficava feio. Após 4 tentativas, a fórmula que
funcionou (replicada de um app de referência que opera no iOS):

- **SOMENTE `U+200B` (bit 0) e `U+200C` (bit 1). SEM marcadores.**
- O **`U+2060` (word joiner)** que usávamos como marcador início/fim era o vilão — tirá-lo resolveu.
- Token no **INÍCIO**, colado ao texto, sem espaço e sem `\n`.
- A sobrevivência vem do **percent-encoding UTF-8** na URL (`U+200B`→`%E2%80%8B`,
  `U+200C`→`%E2%80%8C`), via `encodeURIComponent` + `api.whatsapp.com/send?...&text=`.
- ID curto (`gerarTrackingId` em `redirect.js` usa 7 chars) = token mais curto.
- Mantemos envelope **versão+checksum** (rejeita lixo invisível); decoder é retrocompatível.

### ❌ O que NÃO funciona (já testado, não repetir)
- `U+2060` como marcador → token some no iOS.
- `U+2800` (Braille) / `U+3164` (Hangul) → ocupam largura → **espaço feio** na mensagem.
- Fillers Hangul `U+115F/U+1160/U+FFA0` → viram **quadradinhos (tofu)** no WhatsApp iOS (a fonte
  não tem glifo). Só `U+200B/U+200C` são realmente invisíveis E sobrevivem.

### ⚠️ Verdade importante
Atribuição correta no iPhone **NÃO prova** que o token sobreviveu — pode ter vindo do **fallback de
clique recente** (10 min, 1 clique único). O próprio app de referência confirma que depende do
fallback também. Se o perfil do lead mostra `tracking_method: recent_click`, foi o fallback; se
`token`, o token sobreviveu. Ambos atribuem certo. Ver [[as 3 armadilhas de atribuição de link]].

## 🌎 Geo-IP do clique (cidade/estado/país) — `api/_geoip.js`

O redirecionador (`api/redirect.js`) resolve a localização do IP no clique e salva
`geo_city/geo_region/geo_region_code/geo_country/geo_country_code` em `tracking_clicks`. O
`lead-profile.js` lê esses campos **direto do clique** (não copia pro lead) e o front mostra na aba
**Rastreamento** do perfil.

- **Ativado por env** `IP_GEOLOCATION_URL` (NÃO versionada — configurar no `.env` local E no
  EasyPanel). Sem ela, `lookupGeoIp` retorna só o que os headers de proxy derem (no EasyPanel não há)
  → cidade/estado/país ficam vazios. **Esse foi o motivo de virem vazios.**
- Provedor atual: **ip-api.com grátis** (45 req/min, HTTP, proíbe uso comercial — trocar por Pro/
  ipinfo Core ao escalar, só mudando a env):
  `IP_GEOLOCATION_URL=http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,regionName,region,city`
- `{ip}` é substituído pelo IP real. O parser (`_geoip.js`) mapeia campos de **vários provedores**:
  ip-api usa camelCase (`regionName`/`countryCode`), ipinfo/ipapi usam outros — todos cobertos.
- **Cache de 24h por IP** (em memória) evita reconsultar o mesmo IP — vantagem sobre o app de
  referência (que não tem cache).
- **Não há geo retroativo**: só cliques NOVOS após a env configurada terão localização.
- ⚠️ Privacidade/LGPD: enviar o IP do lead a um terceiro. Por isso o código **não** consulta nada
  sem a env explicitamente configurada (decisão deliberada).

## 🎯 Parâmetros do anúncio capturados no clique (placement, IDs Meta, gclid)

Além das 4 UTMs e do `fbclid`, o redirecionador (`api/redirect.js`) captura da **query da URL** mais
parâmetros do anúncio e salva em `tracking_clicks`:

- `placement` — posicionamento (`{{placement}}`): Instagram_Stories, Facebook_Feed, etc.
- `ad_id`, `adset_id`, `meta_campaign_id` — **IDs numéricos** da Meta (`{{ad.id}}`/`{{adset.id}}`/
  `{{campaign.id}}`), para cruzar com o Gerenciador de Anúncios.
- `gclid` — Google Click ID (quem roda Google Ads; o Google adiciona sozinho com auto-tagging).

> ⚠️ A coluna é **`meta_campaign_id`** (NÃO `campaign_id`): `tracking_clicks.campaign_id` já existe
> como FK para `tracking_campaigns`. Nunca renomear para `campaign_id` — quebra a FK.

### Fluxo (igual ao geo)
`redirect.js` salva no clique → `lead-profile.js` lê do clique principal e expõe em `lead.click_ad`
→ front (`js/leads.js` `lpPreencherDados`) mostra na aba **Rastreamento** do perfil (junto de IP/geo).
Schema auto-migra (`ADD COLUMN IF NOT EXISTS` em `_tracking-schema.js`). Sem dado retroativo: só
cliques novos. Aceita aliases na query (`adid`→`ad_id`, `campaign_id`→`meta_campaign_id`).

### Modelo de URL para o campo "URL do site" do anúncio (Meta)
```
https://<dominio>/r/<slug>?utm_source={{site_source_name}}&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&placement={{placement}}&ad_id={{ad.id}}&adset_id={{adset.id}}&meta_campaign_id={{campaign.id}}
```
As `{{variáveis}}` só funcionam no campo **URL do site** (não no Display URL). O redirect lê tudo da
query e grava no servidor no momento do clique — não depende de PageView.

> Para adicionar um parâmetro novo no futuro: (1) coluna em `_tracking-schema.js` (criação + ADD
> COLUMN), (2) capturar+INSERT em `redirect.js`, (3) SELECT + `lead.click_ad` em `lead-profile.js`,
> (4) `lpRow` na aba Rastreamento (`js/leads.js` + `<div id>` no `index.html`). Publicado: `f7ab081`.

## 🚫 Atribuição de link: SÓ por token/CTWA — fallback por tempo REMOVIDO (2026-06-21)

> **NÃO reintroduzir atribuição por "clique recente"/correlação de tempo.** Foi removida de propósito.

Existia em `api/webhook-evo.js` um fallback: quando a mensagem chegava **sem token** e havia 1 clique
pendente na instância nos últimos 10 min, assumia-se que casavam. **Isso atribuía ERRADO** — o clique
(`tracking_clicks`) **não guarda o telefone de quem clicou**, então era um chute por coincidência de
horário. Em produção, conversas orgânicas ("Bom dia filha", "feito xixi") foram marcadas como
`campaign_link` só porque caíram na janela de um clique de anúncio de OUTRA pessoa. Removido em `f2d9c53`.

### Regra atual de atribuição ao anúncio (decisão do usuário)
A atribuição de campanha só acontece com **CERTEZA**:
1. **Token invisível validado** (`clickTrackingId` casa com um clique pendente) → `tracking_method='token'`.
2. **CTWA nativo** (`ctwaClid` no payload) → fluxo CTWA.

Sem token e sem ctwaClid, o lead **NÃO recebe campanha**. Ele segue **puramente** a Captura Orgânica
configurada pelo usuário (`lead_capture_settings.capture_mode`): `all`→`organic`, `keyword`+match→
`organic`, senão **ignorado** (`tracking_ignored`). Nada de atribuição inventada por trás.

### Limitação aceita (consequência)
No **iPhone o token quase sempre morre** (o WhatsApp iOS remove os zero-width). Sem o fallback, esses
cliques de anúncio chegam mas **não são atribuídos** ao lead — o clique fica `clicked` e a mensagem
vira orgânica/ignorada conforme o modo. É o trade-off escolhido: **atribuição errada é pior que
ausente**. Para capturar esses leads (sem campanha), o usuário usa modo `all` na Captura Orgânica.

### O problema em aberto (não resolvido)
Ligar clique↔lead com certeza no iPhone exige um identificador que venha **na própria mensagem** do
WhatsApp (ex: `ctwa_clid` que a Evolution possa entregar no payload). O `fbclid` real fica só no
clique (navegador), não na mensagem — por isso não dá pra cruzar. Próximo passo, se for atacar:
investigar o que a Evolution entrega no payload para anúncios de mensagem (não confundir com o token).

> Como distinguir tráfego REAL de teste em `tracking_clicks.fbclid`: real = string longa da Meta
> (`PAZ...`, `IwZXh0bgNhZW0...`, com `adid` embutido). Teste = `IwAR0TESTE_*`. NULL = acesso direto.

## 🎯 Jornada de Conversões Meta — CAPI centralizado, 2 canais, eventos configuráveis

Sistema de envio de eventos de conversão à Meta, configurável por cliente. **TODO envio CAPI passa
por `api/_capi.js`** (`enviarConversao`) — não recriar lógica de envio espalhada (antes havia 5
funções duplicadas em 3 arquivos; foram unificadas).

### `api/_capi.js` — o módulo central (fonte única)
- **`enviarConversao({ lead, concept, value, currency, pool })`**: decide o canal, monta o
  `user_data` hasheado (SHA-256), envia (Graph v25) e grava em `lead_journey_history`.
- **Canal automático** por `resolverCanal(lead)`: lead com `ctw_aci_id` → `business_messaging`
  (WhatsApp); senão → `website` (link, usa fbc/fbp/ip/ua).
- **`event_id` DETERMINÍSTICO**: `j_<lead_id>_<concept>` → a Meta deduplica reenvios, e o disparo
  MANUAL (painel) + AUTOMÁTICO (webhook) do mesmo conceito **não duplicam** o evento.
- **`EVENT_NAME[canal][concept]`**: mapa conceito→nome real. `null` = conceito não existe no canal →
  `enviarConversao` rejeita com erro claro (NÃO envia lixo).
- **Exports (fonte única front+back):** `CONCEPTS` (key/label/web/wpp), `CONCEPT_KEYS` (todos),
  `CONCEPT_KEYS_WPP` (só os válidos no WhatsApp). O front lê via `GET /api/journey-stages?meta=concepts`.
- **`extrairValor(texto, regex)`**: extrai valor BR (`R$ 1.250,90`→1250.9) com guard (regex do
  usuário não trava o webhook). Grupo nomeado `(?<value>...)`.

### ⚠️ Eventos por canal (NÃO todos funcionam no WhatsApp)
A Meta REJEITA eventos só-web no `business_messaging`. Válidos por canal:
- **business_messaging (WhatsApp/CTWA):** `LeadSubmitted, QualifiedLead, AppointmentBooked,
  InitiateCheckout, Purchase` (5 — `CONCEPT_KEYS_WPP`).
- **website (link):** os 11 — inclui `Contact, CompleteRegistration, AddToCart, Subscribe,
  ViewContent, SubmitApplication` além dos acima (`Lead`/`Schedule` no lugar de `LeadSubmitted`/`AppointmentBooked`).
> ⚠️ Doc da Meta NÃO confirma 100% `QualifiedLead/AppointmentBooked/InitiateCheckout` no WhatsApp —
> **validar 1 a 1 no Test Events** antes de produção; se rejeitar, tirar de `wpp` no `_capi.js`.

### As duas formas de disparar (UI no modal Editar Cliente)
- **Aba "Inteligente"** (canal mensagem/CTWA): jornada por **palavra-chave do atendente** (`fromMe`).
  Tabela `journey_stages` (por cliente): nome, `event_concept`, `keywords`, `value_regex`. O select
  só mostra os 5 eventos `wpp`. Absorveu o Template de Venda + Gatilho de Qualificação (a aba "Venda"
  foi removida; Permissões foram p/ aba "Dados"). Disparo: `processarJornadaFromMe` no `webhook-evo.js`
  (bloco `fromMe` — usar SÓ `clienteIdFm`/`telefoneFm`, nunca `instance`). Regra "sequencial
  permitindo pular": etapas anteriores viram `skipped` sem reenviar.
- **Aba "Link de rastreamento"** (canal web): por campanha, caixinha **`conversion_auto`** +
  `conversion_event` (lista completa, inclui Contact). Clique = `PageView` fixo (redirect); a
  CONVERSÃO (clique vira lead) dispara o evento escolhido — SÓ se `conversion_auto=true`. Disparo:
  `webhook-evo.js` ~linha 544, lê `conversion_event`/`conversion_auto` da campanha e chama `enviarConversao`.

### Tabelas (auto-migram via `ensureTrackingSchema`)
- **`journey_stages`** (config por cliente): etapas da jornada inteligente.
- **`lead_journey_history`** (1 linha por lead+etapa, `UNIQUE(lead_id,stage_id)`): histórico com
  `meta_status` (pending|sent|error|skipped), `event_id`, `fbtrace_id`, `value`. Conversão de link
  não tem stage_id → dedup por `event_id`.
- **`tracking_campaigns`**: `conversion_event VARCHAR(40) DEFAULT 'lead'`, `conversion_auto BOOLEAN DEFAULT false`.
- **`leads_tracking`**: `current_stage_id`, `stage_changed_at`, `scheduled_at`.

### Onde aparece no painel
- Config: modal Editar Cliente → abas **Inteligente** e **Link** (dentro de Gestão de Clientes, por
  cliente — NÃO no menu lateral). Endpoint CRUD: `api/journey-stages.js` (+ `action='resend'`).
- Histórico do lead: drawer de perfil → aba Jornada → "Eventos de Conversão (Meta)" com badge de
  status + botão **Reenviar** (`lpCarregarEventos`/`lpReenviarEvento` em `js/leads.js`).

### Venda/Qualificação MANUAL (`api/leads-update.js`)
Usa o `enviarConversao` central (mesmo event_id → não duplica com o automático) e grava no
`lead_journey_history`. As ~245 linhas de CAPI duplicado foram removidas.

> Para adicionar um evento novo: (1) `EVENT_NAME` + `CONCEPTS` em `_capi.js` (define se é web/wpp),
> (2) o resto (UI, validação, histórico) deriva automaticamente da fonte única. Commits da feature:
> `3df6332` (backend), `1fa9142` (UI v1), `ad60ebe` (link x inteligente), `4a4102c` (reorg abas +
> caixinha auto), `c9ade87` (validação por canal).

## ⚡ Otimizações de Performance e UX (2026-06-24)

Commit `8c2f0c4`. Cinco melhorias implementadas após análise e validação contra o código real.

### 1. Lazy load de scripts pesados (Chart.js / html2canvas / jsPDF)
- Chart.js, chartjs-plugin-datalabels, html2canvas e jsPDF **removidos do `<head>`** — não são mais baixados em toda sessão (~500 KB a menos no carregamento inicial).
- `loadScript(url)` em `js/utils.js` — carrega um `<script>` dinamicamente, singleton por URL (não duplica).
- `ensureChart()` em `index.html` — chamada no início de `carregarAnuncios()`; carrega Chart.js + datalabels só ao abrir a aba Anúncios.
- `ensurePdf()` em `index.html` — chamada no início de `exportarRelatorioPDF()` (`js/leads.js`); carrega html2canvas + jsPDF só ao exportar.
- **Ao adicionar novo gráfico ou export:** sempre chamar `ensureChart()` / `ensurePdf()` antes de usar as libs — elas não estão mais no escopo global desde o início.

### 2. Cache in-memory de leads (`js/leads.js`)
- `MemCache` (classe com TTL configurável) em `js/utils.js`.
- `_leadsCache` com TTL de **2 minutos** em `js/leads.js` — chave `"clienteId|periodo"`.
- `recarregarLeads()`: se há cache válido, serve os dados imediatamente (sem skeleton, sem piscar) e dispara revalidação silenciosa em background via `_recarregarLeadsFetch()`.
- Cache é **invalidado ao trocar de cliente** (`trocarClienteAdmin` chama `_leadsCache.clear()`).
- O auto-refresh de 30s chama `recarregarLeads(true)` (silencioso) — sempre passa pelo fetch, mantendo o cache fresco.

### 3. Skeleton na tabela de links rastreáveis (`js/captacao.js`)
- `_capRenderSkeleton(lista)` — espelha as 6 colunas da tabela (`Nome/Link`, `Modo`, `Cliques`, `Conv.`, `Status`, `Ações`).
- Chamada em `carregarCampanhasLink()` substituindo o texto plano "Carregando…".

### 4. Card view mobile na tabela de leads
- `@media(max-width:768px)` em `css/dashboard.css`: `.leads-table-wrap thead` oculto, linhas `<tr>` viram cards em grid 2 colunas.
- `data-label="..."` adicionado em todas as `<td>` de `renderTabela()` (`js/leads.js`) — o CSS usa `::before { content: attr(data-label) }` para exibir o rótulo de cada campo no card.
- Skeleton (`sk-row`) preservado: volta ao `display:table-row` em mobile para não quebrar o layout de carregamento.

### 5. `:root {}` unificado no CSS (`css/dashboard.css`)
- Os dois blocos `:root {}` separados (tokens estáticos + tema dark) foram **fundidos em um único bloco**.
- Adicionados tokens novos: `--transition-fast: all 0.15s ease`, `--transition-base: all 0.2s ease-in-out`, `--success: #10b981`, `--warning: #f59e0b`, `--danger: #ef4444`, `--color-whatsapp: #25d366`.
- Classes utilitárias (`.bg1`, `.text2`, `.accent-r`, etc.) atualizadas para usar variáveis em vez de valores literais hardcoded.

### Fix XSS incluído no mesmo commit
- `lpRow()` em `js/leads.js` agora chama `esc(valor)` antes de injetar no `innerHTML` do drawer de perfil do lead. A tabela principal já estava protegida; só o drawer ficava de fora.

## 🔐 Permissões de Abas por Cliente (2026-06-24)

Commits `5eac6a3` (checkboxes) e `d30999f` (F5 sem logout).

### Permissões configuráveis (modal Editar Cliente → aba Dados)
8 checkboxes, cada um controlando uma aba independente:

| Checkbox | Chave (`p.*`) | Aba controlada |
|---|---|---|
| Leads | `leads` | `btn-leads` |
| Meta Ads | `anuncios` | `btn-anuncios` |
| Relatórios | `relatorios` | `btn-relatorios` |
| Conexão WhatsApp | `whatsapp` | `btn-whatsapp` |
| Link de Rastreamento | `captacao` | `btn-captacao` |
| Rastreamento Inteligente | `inteligente` | `btn-inteligente` |
| Relatórios Automáticos | `zaprelatorios` | `btn-zaprelatorios` |
| Minha Conta | `conta` | `btn-conta` |

As permissões são salvas em `clientes.permissoes` (JSONB). O `tabMap` em `index.html` (`init()`) controla o `display` de cada `btn-*`.

### Abas só-admin (nunca aparecem no tabMap de clientes)
`btn-agencia`, `btn-ajustes`, `btn-logs` — ficam `display:none` no HTML e são exibidos via JS apenas para `is_admin`.

### F5 reflete mudanças sem logout — `GET /api/me`
**Problema:** permissões ficavam gravadas no JWT (válido 7 dias). F5 só lia o `localStorage`, nunca o banco.

**Solução:** `api/me.js` (`GET /api/me`) busca `permissoes` frescas do banco. O `init()` chama esse endpoint **antes** de montar o `tabMap` e atualiza o `adlytics_user` no `localStorage`. Fallback silencioso: se `/api/me` falhar, usa as permissões do JWT sem quebrar o dashboard.

> **Ao adicionar uma aba nova:** (1) criar `btn-<nome>` no menu, (2) adicionar checkbox `perm<Nome>` no formulário de Editar Cliente, (3) adicionar leitura em `admin.js` (`$('perm<Nome>').checked = p.<nome> !== false`), (4) adicionar escrita em `admin.js` (`<nome>: $('perm<Nome>').checked`), (5) adicionar entrada no `tabMap` do `init()`.

## 🆔 external_id no CAPI Web — tracking_id como identificador de lead (estilo tintim_gid)

Para leads de **link rastreável** (`lead_origin = 'campaign_link'`), o `tracking_id` do clique (gerado pelo `redirect.js`, ex: `A3F9C2B`) é hasheado SHA-256 e enviado como `external_id` em **todos os eventos CAPI canal `website`** daquele lead.

- Mesmo identificador em `Contact`, `Purchase`, `QualifiedLead`, etc. — a Meta reconhece como a mesma pessoa avançando no funil.
- Equivalente ao `tintim_gid` do Tintim: ID gerado no clique, persistido no banco (`tracking_clicks.tracking_id`), reutilizado em cada evento.
- **Leads CTWA** não recebem `external_id` por este caminho — já têm `ctwa_clid` como identificador forte.
- **CPF** (`external_id` via CPF) só é enviado no canal `business_messaging` (WhatsApp), nunca sobrepõe o `tracking_id` no canal web.

### Onde está implementado
- `api/_capi.js` — bloco `website`: `if (lead.tracking_id) userData.external_id = [hash(lead.tracking_id)]`
- `api/webhook-evo.js` — SELECT do JOIN com `tracking_clicks` inclui `k.tracking_id`
- `scripts/resend-contact-event.js` — inclui `k.tracking_id` no SELECT e no `user_data`

### Coluna de origem (`lead_origin`) e plataforma no painel
- Badges em `js/leads.js` (`obterOrigemLead`): `ctwa`→"Anúncio CTWA", `campaign_link`→"Link rastreável", `organic`→"Orgânico", `bio`→"Link da bio", `rotator`→"Rotador", `intelligent`→"Rastr. inteligente".
- **Plataforma** de leads `campaign_link`/`bio`/`rotator` usa `utm_source` como fallback quando `plataforma` é NULL: `ig`→instagram, `fb`→facebook.

## 🚀 Script de site externo — botões dinâmicos e MutationObserver (2026-07)

Em sites React/Next com lazy loading (componentes carregados via `React.lazy`/`next/dynamic`, seções
que só renderizam ao rolar), o `wapptrack.js` pode rodar `ligarBotoes()` ANTES do React montar
botões de componentes tardios (ex: `FloatingWhatsAppButton`, menu mobile) — esses ficam sem listener.

**Solução:** no componente raiz do site (`App.tsx`), um `MutationObserver` no `document.body` chama
`window.wapptrackRefresh?.()` sempre que qualquer nó novo é adicionado ao DOM. Cobre automaticamente
qualquer botão que apareça depois do carregamento inicial, sem precisar chamar `wapptrackRefresh()`
manualmente em cada componente.
```jsx
useEffect(() => {
  window.wapptrackRefresh?.();
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(m => m.addedNodes.length > 0)) window.wapptrackRefresh?.();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}, []);
```
Validado em produção no site do Frigorífico O Eron — resolveu o botão Hero/menu/flutuante que não
abria o WhatsApp ao clicar (o clique simulado via `.click()` não disparava nenhum fetch porque o
listener nunca tinha sido religado após o lazy-render).

### Checklist de instalação em site novo
1. Colar o `<script src=".../js/wapptrack.js" data-campaign="slug">` antes do `</body>`.
2. Todo botão de WhatsApp precisa de `data-wapptrack-button`; se tiver ícone+texto, marcar o texto
   com `data-wapptrack-label` (senão o script não mexe, para não apagar o ícone — ver seção anterior).
3. Remover qualquer `href="wa.me/..."` ou `onClick` fixo do botão — só o script deve controlar o clique.
4. **Se o site usa lazy loading/scroll reveal**, adicionar o `MutationObserver` acima no componente
   raiz. Sites HTML puro (sem framework) não precisam desse passo.
5. Testar no Console: `document.querySelectorAll('[data-wapptrack-button]').length` deve bater com o
   número de botões esperado; `document.querySelector('[data-wapptrack-button]').click()` deve gerar
   uma chamada de rede para `/api/site-whatsapp-click` (verificar na aba Network, filtro Fetch/XHR —
   os pixels do Facebook (`SubscribedButtonClick`) aparecem à parte e não são o teste relevante).

## ⚡ Gzip + Cache-Control nos arquivos estáticos (`server.js`)

`index.html` (340KB) e os `.js`/`.css` do painel eram servidos crus, sem `Cache-Control` nem
compressão — toda visita/F5 baixava tudo de novo. Corrigido no bloco de estáticos do `server.js`
(usa `zlib` nativo do Node, nenhuma dependência nova).

- **Gzip**: só tipos texto (`.html/.js/.css/.json/.svg`) e só quando o cliente envia
  `Accept-Encoding: gzip`; imagens não são comprimidas (já vêm comprimidas no formato).
- **Cache-Control por categoria** (checar `path.basename` e `url.searchParams.has('v')` da
  REQUISIÇÃO, não do nome do arquivo):
  - Shell do SPA (`index.html`, `login.html`, `share.html`): **`no-cache`** — sempre revalida, nunca
    fica preso numa versão antiga após deploy.
  - `wapptrack.js` (roda em sites de TERCEIROS, sem `?v=` — clientes colam a URL fixa no site deles):
    **`max-age=300, must-revalidate`** (5 min) — cache longo aqui prenderia clientes numa versão velha.
  - Demais assets em `/js/`/`/css/` **com `?v=` na query** (ex: `leads.js?v=20260622-1`): **1 ano
    `immutable`** — o `index.html` já versiona `dashboard.css`, `leads.js`, `admin.js`, `captacao.js`
    dessa forma; trocar o `?v=` invalida o cache automaticamente.
  - Assets **sem `?v=`** (ex: `utils.js`, `reports-auto.js` — ainda não versionados): **5 min** —
    fallback seguro, evita ficar preso caso um arquivo não versionado mude.
  - Imagens (`/img/`, `.png/.jpg/.webp/.ico`): **1 dia**.
- Resultado medido: `index.html` 340KB → ~70KB com gzip (queda de ~79%).
- **Ao adicionar um JS/CSS novo no `index.html`:** sempre referenciar com `?v=<data>-<seq>` (padrão já
  usado) para poder usar cache longo com segurança; sem isso cai automaticamente no fallback de 5 min.
- **Confirmado em produção** (commit `edd46a9`): `index.html` 340.538 → 70.422 bytes com gzip,
  `Cache-Control: no-cache` no shell, `max-age=31536000, immutable` em asset versionado (`leads.js?v=`),
  `max-age=300, must-revalidate` no `wapptrack.js`, `/health` e `index.html` seguem 200 (sem regressão).

## 📋 Relatórios Automáticos (Zap) em 2 níveis: Agendamento → Relatórios (2026-07)

Reestruturado de 1 nível (cada linha = tudo junto: conta+destino+filtro+mensagem) para 2 níveis,
porque um cliente com 3 campanhas de objetivos diferentes precisava de 3 linhas soltas e
visualmente idênticas na tabela — sem escalar bem com muitos clientes/campanhas.

### Nível 1 — Agendamento (`zap_destinos`, novo)
Representa o canal/destino de um cliente: **nome livre** (novo, ex: "Rodrigo Mendanha 2"), conta
de anúncios e destino WhatsApp — todos **fixos**. Criado uma vez por cliente/canal. CRUD em
`api/zap-destinos.js`. `DELETE` usa `ON DELETE CASCADE` — apagar o agendamento apaga os relatórios
filhos automaticamente (mesmo padrão de `tracking_campaigns`→`tracking_destinations`).

### Nível 2 — Relatório (`zap_agendamentos`, reaproveitada, N por agendamento)
A tabela `zap_agendamentos` **manteve o nome** mas agora representa o "relatório": filtro de
campanha/objetivo, mensagem/template, frequência, horário, período, status — vinculado ao pai via
`destino_id` (FK nullable, para não quebrar linhas legadas). CRUD em `api/zap-reports.js`, que
aceita `?destino_id=X` no GET para listar só os relatórios de um agendamento.

### Migração de dados (produção já tinha configurações reais)
`scripts/migrate-zap-destinos.js` — agrupa linhas de `zap_agendamentos` sem `destino_id` por
`(cliente_id, instance_name, destino_tipo, destino_jid, account_id)`, cria 1 `zap_destinos` por
grupo distinto e vincula todas as linhas daquele grupo. Idempotente (só processa `destino_id IS
NULL`), aditivo (nunca apaga as colunas antigas de `zap_agendamentos`). Rodar uma vez em produção:
```bash
node -r dotenv/config scripts/migrate-zap-destinos.js
```

### Cron (`api/cron/send-reports.js`)
Query agora faz `LEFT JOIN zap_destinos d ON d.id = r.destino_id` — o corpo do loop continua usando
`ag.instance_name`/`ag.destino_jid`/etc. sem mudança (os nomes de coluna do JOIN são idênticos aos
antigos). Único ajuste: `ag.account_id` → `ag.destino_account_id` (evita colisão de alias com
`cliente_account_id`). Linhas legadas sem `destino_id` (pré-migração) são puladas com log de aviso.

### UI (`index.html`)
- Lista principal (`zapDestinosLista`/`_renderZapDestinos`) — cards expansíveis por agendamento
  (clique no card expande/recolhe, `_zapExpandido` guarda quais estão abertos); dentro de cada um,
  a lista de relatórios (`_renderZapRelatoriosLista`) com badge de campanha (reaproveitando
  `_zapCampanhaLabel`) + botão "Criar Relatório".
- **`#modalZapDestino`** (nível 1): nome, conta de anúncios, instância, destino (grupo/contato).
  Funções: `abrirModalZapDestinoNovo/Editar`, `salvarZapDestino`, `zapVerificarCamposDestino`.
- **`#modalZapRelatorio`** (nível 2, reduzido): filtro de campanha, frequência/horário/período,
  mensagem+preview. Funções: `abrirModalRelatorioNovo/Editar`, `salvarZapRelatorio`.
- **Preview (`zapAtualizarPreview`) herda o `account_id` do agendamento pai** via
  `_zapDestinosCache[_zapRelatorioDestinoId]?.account_id` — não pede a conta de novo no modal de
  Relatório, porque ela é fixa no nível 1.
- `_carregarInstanciasZap`/`_carregarContasZap`/`zapModalOnInstanciaChange`/`zapOnTipoChange`
  continuam os mesmos (só chamam `zapVerificarCamposDestino` em vez do antigo `zapVerificarCampos`).

> Existe uma tabela/feature paralela morta (`relatorios_agendados`, `setup-reports-db.js`,
> `api/reports-config.js`) — não referenciada no `index.html` atual, não faz parte deste fluxo.

### Preview lado a lado + fix de NOT NULL legado (2026-07)
- Modal do Relatório alargado (920px) com grid de 2 colunas: mensagem+chips à esquerda, preview
  sticky à direita (`zapPreviewArea`/`zapPreviewVazio` alternam visibilidade em `zapAtualizarPreview`).
  Responsivo: empilha em telas <720px.
- **Bug corrigido:** ao reestruturar em 2 níveis, `zap_agendamentos.instance_name` e `destino_jid`
  continuavam `NOT NULL` (herdado do schema de 1 nível), mas o INSERT novo de relatório não envia
  mais esses campos (migraram para `zap_destinos`) → erro `null value in column "instance_name"
  violates not-null constraint` ao criar relatório. Corrigido com `ALTER COLUMN ... DROP NOT NULL`
  nos 3 pontos de auto-migração (`setup-db.js`, `api/zap-reports.js`, `api/zap-destinos.js`,
  `api/cron/send-reports.js`). **Se reaparecer esse erro em outro ambiente/banco não migrado,
  é sinal de que essa migração específica não rodou** — conferir se os 3 arquivos estão atualizados.

## 🎯 Conversão Google Ads no link rastreável (2026-07)

Paralelo ao CAPI Web da Meta, mas **arquitetura deliberadamente diferente**: Google Ads não tem um
equivalente simples ao CAPI server-side da Meta sem OAuth2/developer token (e a Google Ads API
legada de conversões offline está sendo restringida/migrada para a Data Manager API a partir de
15/06/2026). Por isso a integração é **100% client-side via `gtag.js`** — sem GTM, sem token
secreto, sem chamada server-side.

### Como funciona
- `gclid` já era capturado desde antes (`api/redirect.js` linha ~247, `api/site-whatsapp-click.js`)
  e salvo em `tracking_clicks.gclid`, mas nunca disparava nada — só ficava armazenado/exibido no
  perfil do lead. Agora fecha o ciclo.
- 2 campos novos em `clientes` (**sem criptografia** — são públicos por natureza, ficam expostos no
  HTML do navegador de qualquer forma): `google_ads_conversion_id` (`AW-XXXXXXXXX`) e
  `google_ads_conversion_label`. Cadastrados na aba **"Google Ads"** do modal Editar Cliente —
  aba **separada** de "Meta Ads" (decisão do usuário, não juntar os dois provedores na mesma aba).
- Em `api/redirect.js`, `htmlPagePixel()` injeta o snippet `gtag.js` (paralelo ao `pixelSnippet` do
  Meta) **somente quando**: o cliente tem `google_ads_conversion_id` E `google_ads_conversion_label`
  configurados **E** o clique veio com `?gclid=...` na URL. Sem qualquer uma dessas 3 condições,
  nada muda no HTML servido — zero risco de regressão no fluxo Meta existente.
- Evento único fixo "conversion" (não replica a flexibilidade de múltiplos conceitos do Meta —
  `LeadSubmitted`/`Purchase`/etc). Decisão deliberada para a primeira entrega.

### Limitação aceita (diferença importante vs. Meta)
A conversão dispara **no momento do clique** (página intermediária do redirect), não quando o lead
responde de fato no WhatsApp — diferente do Meta, que tem uma segunda conversão ("Lead") disparada
pelo `webhook-evo.js` quando o clique vira lead confirmado. **Não há disparo no webhook para Google
Ads.** Se no futuro for necessário atribuir só quando o lead responder de verdade, seria preciso
migrar para a Google Ads API server-side (Enhanced Conversions) — infraestrutura mais pesada, fora
do escopo desta entrega.

### Diagnóstico
Logs em `webhook_logs` (tag `google_ads_click`): `info` quando o snippet foi injetado com sucesso,
`warn` quando havia `gclid` no clique mas o cliente não tinha ID/label configurado (sinal de que
falta cadastrar). Visível na aba Logs do Sistema, mesmo padrão da tag `capi_web` da Meta.

### Extensão para o script de site externo (`wapptrack.js`) — 2026-07
A conversão Google Ads acima cobre só o link rastreável interno (`/r/<slug>`). Estendida também
para o `js/wapptrack.js` (sites externos, ex: Frigorífico O Eron), com uma diferença importante de
timing: **aqui não existe página intermediária** — o clique no botão já abre o WhatsApp direto, sem
o delay de ~1.4s que o `redirect.js` usa para o Pixel/gtag terem tempo de disparar.

- `api/site-pageview.js`: devolve `google_ads_id`/`google_ads_label` na resposta do PageView — só
  preenchidos quando o clique teve `?gclid=...` **e** o cliente tem os 2 campos configurados (mesma
  regra condicional do `redirect.js`, decidida no backend).
- `js/wapptrack.js`: guarda essas credenciais (variáveis `googleAdsId`/`googleAdsLabel`, preenchidas
  na resposta de `registrarPageview()`) e dispara a conversão dentro de `abrirWhatsapp()` — **no
  clique do botão**, não no PageView, já que aqui o clique é o próprio evento de conversão (sem
  página intermediária para aguardar). `ensureGtagLib()`/`dispararConversaoGoogleAds()` seguem o
  mesmo padrão de `ensurePixel()` (Meta) já existente no arquivo.
- `gclid` já era capturado em `collectParams()` desde antes — nenhuma mudança na captura, só no que
  é feito com o dado depois de chegar no backend.

## 🎨 Página de redirecionamento personalizável por link (2026-07)

A telinha intermediária do link rastreável (`/r/<slug>`, gerada por `htmlPagePixel` em
`api/redirect.js`) — que aparece ~1.4s antes de abrir o WhatsApp enquanto o Pixel/gtag dispara — é
personalizável **por link**: título, subtítulo e cor de fundo. Visual em card branco centralizado
sobre a cor escolhida (spinner verde). Campos vazios → usa os padrões.

### Onde configura / onde flui
- **Modal de link → aba Configuração** (`index.html`): seção "Página de redirecionamento" com
  `capRedirectTitle` (120 chars), `capRedirectSubtitle` (200), `capRedirectBgColor` (`<input
  type="color">`, default `#e5ddd5`).
- **`js/captacao.js`**: reset (color reseta pra `#e5ddd5`, não `''`, senão o picker fica preto),
  preenchimento na edição, e leitura em `capBodyCliente` → `redirect_title/subtitle/bg_color`.
- **`api/tracking-campaigns.js`**: INSERT (slice 120/200/20) + UPDATE (allow-list `campos[]`).
- **3 colunas** em `tracking_campaigns` (`redirect_title/subtitle/bg_color`), auto-migram via
  `ensureTrackingSchema`. `redirect.js` usa `SELECT *`, então já chegam no `campaign`.

### ⚠️ Segurança (não remover)
Título/subtítulo/cor vêm do usuário e são injetados em HTML/CSS inline. Em `api/redirect.js`:
- **`escHtml()`** escapa `< > & " '` do título/subtítulo — sem isso, `<script>` no título = XSS na
  página servida a QUALQUER pessoa que clicar no link.
- **`corSegura()`** valida a cor por regex (só `#hex`, `rgb()/rgba()`, ou nome CSS `[a-z]{3,20}`) —
  qualquer coisa fora disso (ex: `red;background:url(x)//`) cai no fallback. Sem isso, injeção de CSS
  arbitrário no `style` inline do `body`.

## 🧹 Limpeza de emojis/símbolos no nome dos leads (2026-07)

`leads_tracking.nome` (vindo de `pushName` do WhatsApp) às vezes chega decorado com emojis (ex:
"🔥 João 🔥"). Adicionada sanitização — **só no campo `nome`**, nunca em `mensagem_recebida`
(conteúdo histórico da conversa, usado no matching de keywords da jornada inteligente,
`mensagemBateKeyword` em `api/webhook-evo.js`).

- `api/_text-sanitize.js` — `limparTextoDecorativo(texto)`: remove emojis (`\p{Extended_Pictographic}`),
  bandeiras (`\p{Regional_Indicator}`) e variation selectors/ZWJ residuais; preserva letras
  acentuadas, números, hífen, parênteses. **Não remove ideogramas CJK** (ex: 彡) — risco de apagar
  nomes legítimos em chinês/japonês, fora do escopo (só emoji "de verdade").
- `api/webhook-evo.js`: aplicado só no momento do INSERT do lead novo (`limparTextoDecorativo(pushName)`)
  — a variável `pushName` original não é alterada mais cedo no fluxo, então logs técnicos anteriores
  ao INSERT continuam com o nome bruto.
- `scripts/clean-lead-names.js` (novo): corrige retroativamente os leads já salvos. Idempotente
  (só altera o que realmente muda após sanitizar — comparação em memória, não precisa de flag de
  "já processado"). Dry-run por padrão:
  ```bash
  node -r dotenv/config scripts/clean-lead-names.js                       # dry-run
  CLEAN_DRY_RUN=false node -r dotenv/config scripts/clean-lead-names.js   # aplica
  CLEAN_INSTANCIA=nome-instancia node -r dotenv/config scripts/clean-lead-names.js  # filtra 1 instância
  ```

## 📈 external_id no canal WhatsApp (Event Match Quality) — 2026-07

O Gerenciador de Eventos da Meta reportava "Identificação externa" como parâmetro **não enviado**
no canal `business_messaging` (WhatsApp) — a Meta estima +15.6% de conversões adicionais relatadas
com esse parâmetro. Antes, `external_id` só era preenchido ali quando o lead tinha CPF (raro).

`api/_capi.js`, dentro do bloco `business_messaging`: `external_id` agora usa CPF quando existir,
senão cai no telefone hasheado como fallback — cobre 100% dos leads (todos têm telefone). Removida
a linha duplicada de CPF que ficava fora do bloco condicional (redundante, já resolvida dentro do
próprio bloco de canal). O canal `website` continua intocado (`tracking_id` como `external_id`, CPF
nunca sobrepõe ali — ver seção "external_id no CAPI Web").

## 💬 Monitor de Conversas (aba "Conversas") — 2026-07

Nova aba que espelha o WhatsApp dentro do painel: lista de conversas, thread com bolhas estilo
WhatsApp real (verde/branco, "rabinho"), mídia (áudio/imagem/vídeo/documento) e **envio** de
mensagens direto pelo painel (texto, emoji, anexos, gravação de áudio).

### Arquivos principais
- `api/_chat-schema.js`: schema da tabela `chat_messages` (migração idempotente, `IF NOT EXISTS`).
- `api/chat-messages.js`: endpoint único com todas as actions (`list_conversations`, `get_messages`,
  `get_media`, `get_lead`, `send_message`).
- `js/chat-monitor.js`: toda a lógica de frontend (polling, renderização, composer, envio, áudio).
- `api/webhook-evo.js` (`salvarChatMessageBestEffort`): grava mensagens **recebidas** na mesma
  tabela — todo envio (painel ou webhook) converge para `chat_messages`.

### Retenção e leitura
- Mensagens retidas por **15 dias** (`message_at >= NOW() - INTERVAL '15 days'` em toda query;
  `api/cron/chat-cleanup.js` deleta as mais antigas a cada 1h).
- Mídia (áudio/imagem/vídeo) **não é salva no banco** — a `media_url` do webhook é a URL
  **criptografada** do próprio WhatsApp, ilegível direto por um `<audio src>`. A `action=get_media`
  busca o base64 já descriptografado via Evolution (`POST /chat/getBase64FromMediaMessage/{instance}`),
  sob demanda, a cada visualização (sem cache em disco/banco — decisão deliberada, ver abaixo).
- Áudio/imagem/vídeo carregam **automaticamente** ao abrir a conversa (fila com concorrência
  máxima de 2, `chatAutoloadMediaQueue`); documento exige clique manual ("Ver documento") para não
  baixar arquivos grandes sem necessidade.
- **Polling de 10s**: atualiza a lista de conversas sempre; se uma conversa já estiver aberta,
  recarrega silenciosamente as mensagens dela também (reflete resposta dada por outro canal, ex.:
  o próprio atendente respondendo pelo celular físico).

### Envio de mensagens (`action=send_message`)
- Reaproveita a mesma API key global da Evolution (`EVOLUTION_API_URL`/`EVOLUTION_GLOBAL_KEY`) e o
  padrão de validação de escopo por instância mais rigoroso do projeto (`api/evo-groups.js`): cliente
  comum só envia por instância com seu prefixo (`cliente_{id}_`) ou vinculada a ele em
  `instancias_mapeamento`.
- Endpoints Evolution por tipo: `sendText` (texto), `sendMedia` (imagem/vídeo/documento/áudio-arquivo,
  `mediatype` variável), `sendWhatsAppAudio` (nota de voz/PTT).
- **Upload de mídia é base64 inline no JSON** (`FileReader.readAsDataURL()` no browser) — mesmo
  padrão já usado pelo logo do white-label (`api/config.js`). Não há multipart/disco/S3 no projeto.
  `MAX_BODY_BYTES` (`server.js`) foi de 2MB → **20MB** para caber vídeo/áudio.
- **Feedback otimista**: a bolha aparece na hora com status pendente (relógio) → enviado (check
  duplo) ou erro (ícone vermelho clicável = reenviar). **Falha não é persistida no banco** — só na
  tela, decisão deliberada (menos escrita, menos complexidade).
- Dedup com o eco do webhook via `ON CONFLICT (instance, message_id) WHERE message_id IS NOT NULL`
  — o `message_id` usado é o que a Evolution retorna na resposta do envio (`evoData.key.id`, com
  fallbacks para outros formatos de resposta conhecidos).
- Emoji: campo de texto aceita emoji nativo do teclado do SO sem tratamento algum (UTF-8 puro); o
  botão de emoji no composer é só um atalho complementar (grid fixo de ~64 emojis comuns, sem lib).
- Gravação de áudio via `MediaRecorder` nativo (sem lib) — grava `ogg/opus` (Firefox) ou `webm/opus`
  (Chrome/Edge); a normalização para o formato nativo do WhatsApp é responsabilidade da própria
  Evolution/Baileys (que já faz isso para toda mídia recebida). Se o áudio gravado não tocar
  corretamente no destino, o problema é FFmpeg ausente na instância Evolution, não deste código.

### ⚠️ Armadilhas já corrigidas (não reintroduzir)
1. **Coluna faltando (`message_at does not exist`)**: a tabela já existia em produção sem uma coluna
   nova adicionada só no `CREATE TABLE IF NOT EXISTS` (que não faz nada se a tabela já existe).
   Corrigido com `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para toda coluna em `_chat-schema.js` —
   **sempre usar esse padrão ao adicionar coluna nova**, nunca confiar só no `CREATE TABLE`.
2. **429 (rate limit) por auto-load de mídia em rajada**: o polling de 10s recarregando a conversa
   aberta disparava a busca de TODA mídia de novo a cada ciclo, mesmo a já carregada. Corrigido com
   `chatAutoloadedIds` (Set local, só marca em caso de **sucesso** confirmado — uma falha permite
   nova tentativa no próximo poll) + concorrência limitada a 2 requisições simultâneas.
3. **Vazamento de bolha otimista entre conversas**: se o usuário trocasse de conversa antes do envio
   anterior resolver, o status (pendente/erro) e o toast apareciam na conversa nova, e "reenviar"
   mandava para o destinatário errado. Corrigido isolando mensagens otimistas por conversa
   (`chatState.optimisticByConversation`, chave = `chatConversationKey`) — só afeta a tela se ainda
   for a conversa ativa; senão fica guardada e reaparece ao reabrir aquela conversa específica.
4. **Scroll "travando" + nova rajada de 429 no poll silencioso**: `chatRenderMessages` reescrevia o
   `innerHTML` inteiro da thread a cada poll de 10s, **mesmo sem mensagem nova**. Isso (a) forçava
   `scrollTop = scrollHeight` toda vez, arrancando o usuário de volta pro fim sempre que tentava rolar
   pra cima pra ler histórico, e (b) recriava os elementos de mídia do zero (voltando pra
   "Carregando..." visualmente), e como a conversa tinha muita mídia, a fila de auto-load da rodada
   anterior nunca terminava antes do próximo poll empilhar uma fila nova por cima → rajada de `get_media`.
   Corrigido com `chatThreadSignature()` (compara quantidade + última mensagem): poll silencioso só
   re-renderiza se algo realmente mudou. Scroll só gruda no fim se o usuário já estava perto do fim
   (`wasNearBottom`, tolerância de 80px) — não interrompe quem está lendo mensagens antigas.

### Badge de origem na lista
Cada conversa mostra a tag de canal do lead vinculado (Anúncio CTWA, Orgânico, Link da bio, Link
rastreável, Rotador, Rastr. inteligente) — reaproveita `obterOrigemLead` de `js/leads.js` (mesmo
mapa de cores/labels do painel de Leads). Sem lead vinculado, sem badge.

### Layout mobile
Abaixo de 1180px, os 3 painéis (lista/conversa/lead) viram telas cheias com slide (`translateX`) e
botões de voltar — um único breakpoint, sem faixa intermediária (já existiu uma entre 780-1180px
que duplicava as setas de navegação; removida).

### ⚠️ Mídia ENVIADA pelo painel não auto-carrega (não reintroduzir)
Mídia que o painel **enviou** (`from_me=true`) é gravada com o `media_url` real do WhatsApp quando o
webhook ecoa a mensagem de volta. Mas a Evolution (`getBase64FromMediaMessage`) **não consegue
servir de volta mídia própria** (esse endpoint é pra mídia recebida) — toda busca falha. Incluir
essas mensagens no auto-load (`chatAutoloadMediaQueue`) causou **rajada de 429** (dezenas de
`get_media` a cada poll, tentando pra sempre). Regras atuais:
- `chatAutoloadMediaQueue` filtra `!m.from_me` — mídia enviada NUNCA entra na fila de auto-load.
- `chatAutoloadedIds.add(m.id)` é feito **antes** da tentativa (não só em sucesso) — qualquer
  mídia falha nunca é reintentada automaticamente (evita loop infinito em qualquer cenário).
- Mídia enviada mostra botão manual ("Ver imagem"/"Ouvir audio") em vez de spinner que nunca
  resolveria. O usuário pode tentar manualmente; reabrir a conversa limpa `chatAutoloadedIds`.

### Poll silencioso só re-renderiza se algo mudou (scroll + 429)
`chatLoadMessages(conversation, silent=true)` (poll de 10s da conversa aberta) compara
`chatThreadSignature()` (quantidade + última mensagem) antes de reescrever o DOM. Sem isso, o poll
reescrevia `chatMessagesList.innerHTML` inteiro a cada 10s → (a) forçava `scrollTop` pro fim,
arrancando o usuário que rolou pra cima pra ler histórico; (b) recriava elementos de mídia,
disparando `get_media` em massa. Scroll só gruda no fim se o usuário já estava perto do fim
(`wasNearBottom`, 80px de tolerância).

### Atalho de conversa em Leads + popup (modal)
Cada linha da tabela de Leads tem um botão verde (WhatsApp, `message-circle`) que abre a conversa
daquele lead num **popup/modal** sobre a própria aba Leads — não navega para a aba Conversas.
- `abrirConversaDoLead(leadId)` (`js/leads.js`): resolve telefone/instância/cliente_id do lead em
  `rawData` e **move fisicamente** os painéis `.chat-thread-panel` + `.chat-lead-panel` do monitor
  para dentro do `#chatModalSlot` (reaproveita os mesmos IDs/listeners — nada de DOM duplicado).
  `fecharConversaModal()` devolve os painéis à `#chatMonitorShell`.
- `chatAbrirConversaPorTelefone(telefone, instance, clienteId)` (`js/chat-monitor.js`): orquestra
  init + filtro de cliente (admin) + carga da lista + seleção da conversa exata
  (`cliente_id|instance|telefone`), com fallback por cliente+telefone se a instância não bater, e
  toast "sem conversa recente" se o lead não tem conversa nos últimos 15 dias.
- Guarda `chatState.openingByPhone`: impede o `chatMonitorInit()` (disparado por
  `mudarAba('conversas')`) de rodar carga duplicada, e impede o auto-select da 1ª conversa em
  `chatLoadConversations` (que causaria flash da conversa errada).
- Polling passa a rodar também com o modal aberto (aba Conversas oculta): `chatStartPolling` checa
  `abaVisivel || modalAberto`. `mudarAba('conversas')` devolve os painéis antes de mostrar a aba.
- Fecha com X, clique fora, ou ESC (handler global de Escape no `index.html`).

### ⚠️ Flash de conversa antiga ao trocar de conversa (corrigido — não regredir)
Ao abrir a conversa de outro lead, a conversa **anterior** aparecia por alguns segundos até a nova
carregar. Corrigido em 3 camadas: (1) `chatSelectConversation` limpa `currentThreadMessages`/
`optimisticMessages`/`chatAutoloadedIds` e chama `chatRenderThreadLoading(conversation)`
imediatamente (mostra spinner + título/meta da conversa nova na hora); (2) `chatLoadMessages`
descarta a resposta se a conversa não é mais a ativa (`chatIsActiveConversation`) — evita que uma
requisição lenta da conversa antiga sobrescreva a nova; (3) o auto-select de `chatLoadConversations`
é pulado quando `openingByPhone`.

### 🔑 SEMPRE bumpar o `?v=` ao editar JS/CSS do chat (armadilha recorrente)
`js/chat-monitor.js`, `js/leads.js` e `css/dashboard.css` têm `Cache-Control: immutable` de 1 ano
(por terem `?v=` no `index.html`). Editar o arquivo **sem** incrementar o `?v=` = o navegador
continua servindo a versão antiga cacheada, e a correção "não funciona" mesmo com deploy OK. Isso
causou várias sessões de "o bug voltou" que eram só cache. **Todo commit que mexe nesses arquivos
DEVE bumpar o `?v=` correspondente no `index.html`** (padrão `?v=AAAAMMDD-N`).
