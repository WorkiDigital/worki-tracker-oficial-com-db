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
- **Métrica de Tempo de Primeira Resposta (Individual):** O tempo que um lead demora para ser respondido pela primeira vez (`first_response_at` vs `created_at`) agora é exibido formatado (em minutos, horas ou dias) diretamente no Drawer do Perfil do Lead.

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

## 🔙 Tentativa de separar Front e API em 2 serviços — REVERTIDA (2026-07-14)

Houve uma tentativa completa de separar o `server.js` único (front+API+webhooks+crons juntos) em
dois serviços EasyPanel independentes: `server-api.js` (só `/api/*`, `/r/*`, `/redirect/*`,
`/js/wapptrack.js`, health, crons) e `server-static.js` (só HTML/CSS/JS/img, com
`window.APP_CONFIG.API_BASE_URL` injetado via `/runtime-config.js`). Chegou a ser implementada,
mesclada no `main` e testada em produção nos dois serviços novos (`worki-tracker-oficial-2-api` e
`worki-tracker-oficial-2-front`) — **mas foi revertida por decisão do usuário antes da migração
completa** (commit de revert `3dffecf`, desfaz `6e06740`..`2db01a9`).

**Estado atual: voltamos 100% ao `server.js` único** (front+API+webhooks+crons no mesmo processo,
mesmo domínio) — é o único servidor válido hoje. `server-api.js`/`server-static.js` **não existem
mais no repositório**. Não recriar essa separação sem alinhamento explícito do usuário.

### Armadilhas descobertas nessa tentativa (úteis se a separação for retomada no futuro)
- **Nixpacks ignora o "Comando de início" customizado da UI do EasyPanel** e cai no `npm start`
  padrão do `package.json` — aconteceu nos DOIS serviços novos (front e depois API), mesmo com o
  campo visivelmente preenchido corretamente (`npm run start:static` / `npm run start:api`) e
  salvo. **Só um rebuild sem cache** (opção separada do botão normal "Implantar") resolveu — um
  redeploy normal não bastou.
- **Cada serviço novo no EasyPanel precisa da própria Deploy Key SSH** no GitHub, mesmo apontando
  pro mesmo repositório de um serviço que já funciona — copiar a URL do repo não é suficiente.
- **Caminho de Build deve ser `/`** mesmo quando a intenção é "puxar só a pasta `api/`" ou "só o
  front" — não existe uma pasta física separada para cada parte neste repo (é o mesmo código,
  arquivos de entrada diferentes). Configurar `/api` ou `/front` como Caminho de Build faz o
  Nixpacks procurar um `package.json` que não existe ali e falhar.
- **`ALLOWED_ORIGINS` não é "qual URL essa API tem"** — é a lista de domínios do FRONT autorizados a
  chamar a API (CORS). Colocar a própria URL da API ali é erro comum e não faz nada de útil.
- Ao trocar de branch de trabalho (`refactor/separate-frontend-api-services`) e voltar pro `main`,
  usar `git stash` para não perder mudanças não commitadas de outra frente (ex: remoção do sistema
  de Score, que rodava em paralelo) — depois `git stash pop` mescla sem conflito se os arquivos não
  se sobrepuserem.

## 🔗 Compartilhar Dash — Filtro por conta ativa do Meta Ads (2026-07-20)

**Problema corrigido:** A aba "Compartilhar Dash" mostrava todas as contas independente de qual conta estava selecionada na aba Meta Ads.

**Solução (`index.html` → `renderShareLinks()`):**
- Ao entrar na aba "Compartilhar Dash", a função verifica `_contaSelecionada` (conta ativa no Meta Ads).
- Se há uma conta ativa, filtra a lista mostrando apenas essa conta + banner azul "Filtrando por: **Nome da Conta**" com botão "Ver todas".
- "Ver todas" mostra todas as contas mas coloca a conta ativa **no topo** com banner informativo.
- Cada vez que abre a aba, reseta para o modo filtrado (`dataset.verTodas = '0'`).
- **Fallback via localStorage:** se o usuário for direto para Compartilhar Dash sem ter aberto Meta Ads antes, tenta recuperar a última conta usada via `adsStorageKey(ACCT_KEY)`.

Commits: `88c1477`

---

## 🗓️ Evento Schedule (Agendamento) no Kanban/Pipeline (2026-07-20)

**Problema:** O evento CAPI `appointment` (Schedule) **só era disparado pelo Rastreamento Inteligente** (via mensagem WhatsApp com palavra-chave). Ao mover um lead para a coluna "Agendado" no Kanban, o evento NÃO era disparado para a Meta e `scheduled_at` NÃO era gravado.

**Causa:** Em `api/leads-update.js`, o mapeamento de conceito CAPI só cobria `purchase` e `qualified`. O status `Agendado` não tinha conceito mapeado.

**Correção (`api/leads-update.js`):**
1. `scheduled_at = NOW()` é agora gravado quando `status = 'Agendado'` (igual ao fluxo via mensagem).
2. `concept = 'appointment'` adicionado ao mapeamento de status → concept CAPI.
3. `event_name = 'Schedule'` adicionado ao mapa de nomes de eventos (`conceptEventName`), antes só tinha `Purchase` e `QualifiedLead`.
4. O histórico em `lead_journey_history` é registrado com `event_name = 'Schedule'`, `concept = 'appointment'` para rastreabilidade.

**Resultado:** os dois fluxos de agendamento agora disparam o evento `Schedule` para a Meta:
- ✅ Via **Rastreamento Inteligente** (mensagem com palavra-chave configurada)
- ✅ Via **Pipeline/Kanban** (arrastar card para coluna "Agendado")

Commits: `f3fd30a`

---

## 💱 Moeda real da conta (não fixo em R$) + auditoria de métricas de Ads (2026-07)

**Problema:** cards/tabela de Ads, dashboard público (`share-dash.js`) e Relatórios Automáticos (WhatsApp) sempre formatavam valores em `R$` fixo, mesmo para contas Meta em USD/EUR. O painel já tinha `getAdsCurrency()`/`formatAdsMinor()` prontos (usados só no fluxo de orçamento), mas não conectados às métricas.

**Correção — painel admin (`index.html`):** `brl()` internamente passou a chamar `getAdsCurrency()` via `Intl.NumberFormat`, sem precisar tocar nas ~30 chamadas espalhadas (cards, tabela, demografia, melhores anúncios, drill-down). Modal de orçamento (`#modalAdsBudget`) também parou de fixar "R$"/"BRL".

**Correção — dashboard público (`share-dash.js`):** aqui a moeda **não existia em nenhum ponto do pipeline**. Solução: nova coluna `share_tokens.currency`, resolvida na Graph API (`fields=id,currency`) no momento de **criar o link** (`api/share-create.js`), devolvida por `api/share-ads.js`, guardada em `_shareCurrency` e usada por `fmtBRL()`. Links criados **antes** dessa mudança ficam em `BRL` (fallback) até serem recriados — sem correção retroativa automática.

**Correção — Relatórios Automáticos (`api/cron/send-reports.js`):** não fazia parte do fix anterior. Agora busca `currency` da conta (`act_{id}?fields=currency`) antes de montar a mensagem de WhatsApp.

### ⚠️ Armadilha: coluna nova em tabela existente exige bootstrap automático, não só `setup-db.js`
Adicionar `currency` só no `CREATE TABLE` de `setup-db.js` **não bastou** — `setup-db.js` só roda manualmente via terminal, não a cada deploy. Resultado: `/api/share-ads` caiu em `500` em produção (`column st.currency does not exist`) até ser criado `api/_share-schema.js` (mesmo padrão lazy de `_extension-pairing-schema.js`: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` com `pg_advisory_xact_lock`, chamado no início de `share-ads.js`/`share-create.js`). **Lição: toda coluna nova em tabela que já existe em produção precisa de um bootstrap automático chamado pelo próprio endpoint — nunca confiar só no `setup-db.js` manual.**

### Auditoria de métricas (4 bugs reais encontrados e corrigidos)
Comparação das 4 fontes que calculam métricas de Ads (`index.html`, `js/share-dash.js`, `api/cron/send-reports.js` + `api/zap-preview-metrics.js` via `api/_zap-report-metrics.js`) contra as regras já documentadas neste arquivo (nunca somar variantes de `action_type`, ROAS via `purchase_roas` ponderado por spend):
1. **ROAS errado nos Relatórios/Preview** (`api/_zap-report-metrics.js`): calculava `Σ(roas por campanha) / Σspend` em vez de `Σ(roas×spend) / Σspend`. Testado com 2 campanhas: fórmula antiga dava `0.0109`, a correta `2.7273` — divergência grave, não cosmética.
2. **Leads subcontados** no mesmo arquivo: só contava `action_type === 'lead'`, faltava o fallback `'offsite_conversion.lead'` que `index.html`/`share-dash.js` já usam.
3. **Métrica "Resultados" inflada** no ranking de Melhores Anúncios do dashboard público (`js/share-dash.js`, `getAdMetric`): somava `omni_purchase`+`purchase`+`offsite_conversion.fb_pixel_purchase` (mesma compra 2-3x) misturado com leads/mensagens. Testado: uma compra de valor 10 aparecia como 33. Corrigido para o maior valor entre compras/leads/mensagens, cada um via first-match.
4. **Moeda fixa em BRL nos Relatórios Automáticos** — ver acima.

Também corrigidos: campo de "Cliques" inconsistente no ranking de Melhores Anúncios (`outbound_clicks` em vez de `link_click`, padrão usado no resto do arquivo); chaves mortas `hook`/`cphook` em `METRIC_META` (resíduo da remoção do Hook Rate, nunca renderizadas).

### Crash de null em `renderTable()` (`js/share-dash.js`)
Campanhas sem `insights` no período (`ins = null`) quebravam a tabela inteira com `Cannot read properties of null (reading 'instagram_profile_visits')` — um acesso direto `ins.instagram_profile_visits` sem `?.`, enquanto o resto da mesma linha (`ins?.spend`, `getAct`/`getActFirst`/`getRoas`) já era seguro. Corrigido para `ins?.instagram_profile_visits`.

**Padrão a seguir:** ao adicionar/editar leitura de `ins` num `.map()`/`.forEach()` sem guarda `if (!ins) return` anterior, sempre usar `?.` — nunca assumir que toda campanha do período tem insights.

Commits: `877c96b`, `5ce451d`, `c49c88d`, `bfa28e6`, `a08fd7e`

---

## ⚡ Escalabilidade, Fila de Webhooks (BullMQ), Soft-Delete e Filtro de Cliques/Filtro Meta Ads (2026-07-21)

### 1. Paridade no Contador de Cliques (Cabeçalho vs. Tabela)
- **Problema:** O card de métricas no cabeçalho ("72 Cliques") filtrava robôs (`HUMAN_CLICK_SQL`), mas a subquery na listagem de campanhas (`api/tracking-campaigns.js`) contava todos os registros (`COUNT(*)`), incluindo crawlers do Facebook/WhatsApp.
- **Correção (`api/tracking-campaigns.js`):** Adicionada a cláusula `BOT_FILTER` em ambas as subqueries da listagem (`cliques` e `conversoes`), garantindo números consistentes entre o cabeçalho e a tabela.

### 2. Escalabilidade P0/P1 para 1.000 Agências × 20 Clientes cada
- **Fila BullMQ (`api/_queue.js`):** O webhook da Evolution (`api/webhook-evo.js`) processava tudo inline (consultas SQL + Graph API + CAPI) segurando a conexão HTTP e saturando o pool de conexões sob picos. Agora responde `200 OK` imediatamente e enfileira no Redis via BullMQ com fallback síncrono transparente se o Redis não estiver ativo.
- **Contadores Materializados (`tracking_campaigns`):** Criadas as colunas `total_clicks` e `total_conversions` na tabela `tracking_campaigns`, incrementadas nas transações de clique (`api/redirect.js`) e conversão. Elimina os `COUNT(*)` correlatos pesados na listagem.
- **Soft-Delete de Clientes (`clientes.archived_at`):** A exclusão de um cliente em `api/clientes.js` executava `DELETE FROM leads_tracking` em cascata, travando o banco de dados por minutos em contas com muitos leads. Agora utiliza soft-delete (`archived_at`), e a autenticação em `api/auth-login.js` nega o login de contas associadas a clientes arquivados.

### 3. Sincronização do Filtro de Cliente na Aba Meta Ads (`index.html`)
- **Problema:** Ao alterar o cliente no seletor global (`selectClienteAdmin`) estando em outra aba (ex: Conversas ou Leads), a função `trocarClienteAdmin` não invalidava o estado da aba Meta Ads porque checava `!$('aba-anuncios')?.classList.contains('aba-oculta')`. Ao navegar para Meta Ads em seguida, `adsCarregado` continuava `true`, mantendo os anúncios do cliente anterior na tela.
- **Correção (`index.html`):** `trocarClienteAdmin` agora reseta incondicionalmente `adsCarregado = false` e `_contaSelecionada = null`. Em `carregarContasAds()`, se o cliente novo não possuir uma conta salva no `localStorage`, seleciona automaticamente a primeira conta disponível (`visiveis.length >= 1`).

Commits: `4aeb608`, `b2ad7e0`

---

## 🔗 Links de captação apontando pro domínio errado após a separação Front/API (2026-07-22/23)

### O bug
Após a separação de `server.js` em `server-static.js` (front) + `server-api.js` (API) em domínios distintos (`adlyticspro...` / `adlyticsapi...`), `js/captacao.js` continuou montando os links `/redirect/<slug>` e o snippet `<script src=".../js/wapptrack.js">` com `window.location.origin` — o domínio de onde o painel é acessado (o **front**). Só que `/redirect/*` e `/js/wapptrack.js` só existem no serviço de **API** (`server-static.js` devolve 404 de propósito pra essas rotas — ver bloco "O frontend separado jamais deve responder rotas da API ou tracking" em `server-static.js`). Resultado: **todo link de campanha copiado do painel desde a separação ficava 404 para quem clicasse.**

- **Correção (`js/captacao.js`):** `baseUrl()` passou a usar `window.APP_CONFIG?.API_BASE_URL || window.location.origin` (o mesmo `runtime-config.js` já usado em outros pontos), com fallback pra `location.origin` quando não há separação (modo legado, tudo no mesmo domínio). Usado tanto no link `/redirect/<slug>` quanto no snippet do `wapptrack.js`.
- **Links criados ANTES do fix continuam com o slug correto no banco** — o que estava errado era só o domínio mostrado/copiado na tela, não o dado salvo. Reabrir/copiar de novo do painel (já corrigido) resolve; anúncios que já saíram com o link antigo (`adlyticspro.../redirect/...`) precisam ser atualizados manualmente para `adlyticsapi.../redirect/...`.

### ⚠️ Armadilha de deploy no EasyPanel (recorrente, já aconteceu 2x) — SEMPRE checar antes de assumir "não corrigiu"
Depois de um `git push` com a correção, o `index.html`/JS servido em produção **pode continuar com o código antigo por horas**, mesmo com commits novos no GitHub e mesmo o serviço já respondendo no domínio certo. Causa: o Nixpacks deste projeto tem um `nixpacks.toml` com `[start] cmd = "node server.js"` fixo como **fallback de segurança** — os serviços separados (`worki-tracker-oficial-2-front`/`-api`) dependem da env `NIXPACKS_START_CMD` (`node server-static.js` / `node server-api.js`) para rodar o arquivo certo. Se essa env não estiver setada corretamente NO SERVIÇO CERTO, o Nixpacks roda o monolito por baixo do domínio errado (o log de build mostra `start │ node server.js` na tabela do plano — sinal claro do problema).

**Diagnóstico correto, nesta ordem, ANTES de mexer em código de novo:**
1. `curl https://<dominio>/health` — deve retornar `{"status":"ok","service":"frontend"}` ou `{"...,"service":"api"}`. Sem o campo `service`, é o monolito rodando.
2. Se o `/health` já estiver certo mas o comportamento continuar errado: `curl https://<dominio>/index.html | grep "nome-do-arquivo.js?v="` — confirma se o HTML servido referencia a versão (`?v=`) do JS que você acabou de bumpar no commit. Pode estar desatualizado mesmo com `/health` correto (o serviço trocou de arquivo mas não pegou o commit mais recente).
3. Corrigir/confirmar `NIXPACKS_START_CMD` no serviço certo (front → `server-static.js`; API → `server-api.js`) **e depois rodar rebuild SEM CACHE** (não o redeploy normal — já confirmado 2x que o redeploy comum não é suficiente para pegar o commit mais novo nem para reprocessar a env var).
4. Só depois de `/health` E a versão do `?v=` baterem com o commit mais recente, testar o comportamento de novo.

**Nunca assumir que uma correção "não funcionou" sem passar pelos passos acima primeiro** — nas duas ocorrências reais (loop de redirect e link de captação com domínio errado), o código já estava certo no repositório; o problema era sempre deploy travado no serviço errado/desatualizado.

Commit: `d371009`

---

## 🎯 Índice de Engajamento Comercial (2026-07-25)

Combina 3 sinais num score 0-100 por lead: Primeira Resposta humana, Tempo Médio de Resposta
(mediana) e Taxa de Engajamento (volume bruto de mensagens trocadas). Exibido só no **Drawer de
Perfil do Lead, aba Venda** — não é uma feature de CRM (sem tarefas/lembretes/follow-up manual).

### Onde mora a heurística anti-bot (arquitetura central)
Em `api/webhook-evo.js`, `salvarChatMessageBestEffort(...)` grava **toda** mensagem (inclusive
`fromMe`) em `chat_messages` — e faz isso **antes** do bloco que atualiza
`leads_tracking.first_response_at`. Isso permite calcular a heurística "isso é bot?" **no momento
do INSERT**, comparando o timestamp da mensagem `fromMe` atual com a última mensagem do lead
(`from_me=false`) do mesmo telefone/instância/cliente já salva — sem recalcular em toda leitura de
métrica. Resultado gravado na nova coluna `chat_messages.is_bot_reply` (calculada 1x na escrita,
consumida como `WHERE is_bot_reply = false` na leitura — barato).

Algoritmo (`calcularIsBotReply` em `webhook-evo.js`): se não existir mensagem anterior do lead,
`is_bot_reply = false` (nada a comparar). Se existir, `is_bot_reply = true` quando o gap entre a
resposta e a última mensagem do lead for menor que `bot_threshold_seconds` (config por cliente,
default 5s) — heurística de 1 mensagem por vez, não modela sequências longas de bot.

> ⚠️ **`first_response_at` legado (card "Resposta Média") NÃO foi alterado** — decisão deliberada
> para não mudar o comportamento de uma métrica já em produção. O card antigo continua contando
> qualquer `fromMe`, incluindo bot (a mesma limitação já documentada na seção "Primeira Resposta da
> Empresa" acima). O índice novo é uma camada adicional, mais precisa, calculada separadamente.

### ⚠️ Limitação aceita: janela de 15 dias
`chat_messages` retém só 15 dias (cron de limpeza, não alterado — decisão de design por volume/
mídia). Os componentes "Tempo Médio" e "Taxa de Engajamento" só são calculáveis dentro dessa
janela. Fora dela: o componente "Primeira Resposta" cai de volta no `first_response_at` legado (sem
filtro anti-bot); os outros 2 ficam `null` ("sem dado") e o peso é redistribuído proporcionalmente
entre os componentes disponíveis — nunca zerado (zerar penalizaria injustamente leads antigos só
por falta de retenção). A UI (`js/leads.js`, `lpCarregarEngajamento`) mostra "calculado com N de 3
componentes" para nunca fingir uma precisão que não existe.

### Cálculo — sem tabela de score persistida
Tudo calculado em tempo real via `api/engagement-metrics.js` (padrão de `api/metrics-temporal.js`:
auth+cors+permissão, `cliente_id`/`lead_id` no query string). Uma tabela persistida ficaria presa
em valores antigos assim que a janela de 15 dias avançasse — por isso não existe.

- **Primeira Resposta**: `MIN(message_at)` do lead até `MIN(message_at)` da 1ª resposta
  `is_bot_reply=false`. Faixas: ≤5min=100, 6-15min=80, 16-30min=60, 31-60min=40, >60min=10, sem
  resposta=0.
- **Tempo Médio**: pareia cada mensagem do lead com a próxima resposta humana subsequente; agrega
  com média E mediana (`PERCENTILE_CONT` equivalente em JS, já que o cálculo roda em memória sobre
  as linhas de `chat_messages` do período, não em SQL agregado puro). **A pontuação usa a MEDIANA**
  — evita que uma única resposta tardia distorça o score; a média fica só como dado complementar.
  Faixas: ≤5min=100, 6-15min=85, 16-30min=65, 31-60min=40, >60min=15.
- **Taxa de Engajamento**: `COUNT(*)` de mensagens do par (ambos os lados, sem comparar proporção)
  na janela de 15 dias. Pontuação via `engagement_settings.engagement_volume_tiers` (JSONB
  configurável, **não hardcoded** — os valores de partida em `_engagement-schema.js` são só
  placeholder, a calibrar com dados reais).

### Configuração por cliente (`engagement_settings`, `api/_engagement-schema.js`)
Lazy-bootstrap (mesmo padrão `pg_advisory_xact_lock` de `_tracking-schema.js`), 1 linha por
`cliente_id`, com fallback nos defaults globais (`ENGAGEMENT_DEFAULTS`) quando não existe linha —
não popula automaticamente para todo cliente. Campos: `bot_threshold_seconds`,
`business_hours_enabled/start/end/days/timezone`, `weight_first_response/avg_response/
engagement_rate` (devem somar 100), `engagement_volume_tiers`. CRUD em `api/engagement-settings.js`
(GET/PUT), UI na aba **"Engajamento"** do modal Editar Cliente (`index.html` + `js/admin.js`,
mesmo padrão das abas Meta Ads/Google Ads). Salvo junto do botão "Salvar Alterações" do cliente
(`engSalvarConfig`, chamado dentro de `salvarEdicaoCliente`) — endpoint separado por ser tabela à
parte, não uma coluna de `clientes`.

### Horário comercial (opt-in, `business_hours_enabled=false` por padrão)
Escopo mínimo deliberado: 1 janela fixa (`HH:MM`-`HH:MM`) + dias úteis (array ISO 1-7) + timezone,
**sem feriados, sem exceções, sem múltiplos turnos**. Implementado como função pura testável
`calcBusinessMinutes(startTs, endTs, config)` em `api/_business-hours.js` (itera dia a dia, soma só
a interseção com a janela) — não como SQL nativo, mais simples de escrever/testar e o volume por
requisição é pequeno o bastante para não exigir push-down ao banco. Reaproveitada pelos componentes
Primeira Resposta e Tempo Médio. Desativado por padrão preserva 100% de compatibilidade (cálculo
de diferença bruta de timestamps, igual ao card "Resposta Média" legado).

### Recalibrar o limiar anti-bot depois de mudar a configuração
Mensagens já gravadas NÃO são reclassificadas automaticamente quando `bot_threshold_seconds` muda —
o valor foi calculado e persistido no momento do INSERT. Use `scripts/recalc-bot-flag.js`
(`RECALC_CLIENTE_ID=<id> RECALC_DRY_RUN=true node -r dotenv/config scripts/recalc-bot-flag.js`)
para reprocessar `chat_messages` dos últimos 15 dias sob demanda, mesmo espírito de
`scripts/fix-page-id.js`.

### Card agregado "Engajamento" nos Relatórios (ao lado de Resposta Média)
`api/engagement-metrics.js` sem `lead_id` retorna a **média do índice** de até 200 leads mais
recentes do cliente/período (`LIMITE_AMOSTRA` — teto de segurança, já que calcular o índice de cada
lead exige 1 query de `chat_messages` por lead; sem teto, um período com milhares de leads pesaria
demais). Card novo no grid de métricas de Leads (`index.html`, `#avgEngagementScore`), 5º card ao
lado de Ciclo Médio/Resposta Média/Leads Esquecidos/Vendas Rápidas. Carregado via
`carregarEngajamentoMedio()` em `js/leads.js`, chamada separada e best-effort dentro de
`carregarMetricasTemporais()` — uma falha aqui não trava os outros 4 cards que já funcionavam.

### Card "Leads Esquecidos" agora filtra a lista (clicável)
O card era só um número, sem ação. `toggleFiltroEsquecidos()` (`js/leads.js`) faz o card funcionar
como toggle: ao clicar, filtra `dadosFiltrados` pelo **mesmo critério exato** já usado no cálculo do
card (`api/metrics-temporal.js`) — `last_interaction_at` com +48h sem contato E status fora de
`venda_fechada/perdido/vendido/agendado` (comparado com `.toLowerCase()`, pela inconsistência de
grafias já documentada acima). Filtro 100% client-side sobre `rawData` (mesmo padrão do
heatmap/comparativo/relatório) — **por isso `api/leads.js` precisou passar a retornar
`last_interaction_at` no payload**, coluna que antes só `metrics-temporal.js` usava (não vinha na
lista de leads). Clicar de novo remove o filtro; feedback visual aplicado direto no `style` do card
(sem classe CSS dedicada — os cards de métrica são estilizados 100% inline neste projeto).

### Busca de leads também encontra por campanha/conjunto/anúncio
O campo de busca (`#inputBusca`) só comparava contra `nome`/`telefone`. Passou a também casar contra
`utm_campaign`, `utm_medium`, `utm_content` e `tracking_campaign_name` — os mesmos 4 campos já
exibidos na coluna "Campanha / Anúncio" da tabela (ver seção "Enriquecimento de UTMs" acima). Sem
mudança de backend: esses campos já vinham no payload de `api/leads.js`, só não entravam na
comparação de busca em `aplicarFiltros()` (`js/leads.js`). Placeholder do campo atualizado para
"Buscar nome, telefone ou anúncio...".

## 🎨 Hierarquia visual da aba Relatórios (2026-07-26)

Reorganização puramente visual — **nenhuma função de cálculo mudou** (`calcMetricasRelatorio`,
`renderComparativoPeriodo`, `agrupar`, `criarGrafico` seguem intocadas). O problema era hierarquia
plana: os 5 cards de métrica tinham peso visual idêntico e os 6 gráficos ficavam num grid único sem
agrupamento temático, competindo pela mesma atenção.

### 1. Card herói de Receita + faixa de apoio
Receita e Conversão saíram do grid de 5 colunas e viraram um bloco `.report-hero` no topo: Receita
grande (34px, gradiente azul sutil de fundo) com o delta de período em badge colorido logo abaixo, e
Conversão + **Ticket Médio** (métrica nova, `receita / vendas.length`) como cards menores ao lado.
Abaixo, `.report-strip` com 4 cards de apoio no mesmo peso: Total, Qualificados, Vendas e **Leads
Esquecidos** (novo card aqui, mesmo critério de `leadEstaEsquecido()` já usado no filtro clicável da
aba Leads — mas aqui é só informativo, sem `onclick`, porque Relatórios não tem uma tabela de leads
visível para filtrar).

### 2. Rótulos de seção agrupando os gráficos por tema
Os 6 gráficos que viviam soltos em `.charts-grid` agora ficam em blocos com título
(`.report-section-title` + ícone lucide): **Evolução** (linha do tempo), **Horários** (heatmap),
**Origem dos leads** (Campanhas/Conjuntos/Anúncios/Plataformas — os 4 gráficos de leads) e **Funil
de vendas** (Anúncios/Vendas e Plataformas/Vendas — os 2 gráficos de vendas, agora num grid de 2
colunas em vez de misturado com os de leads).

### 3. Delta de Receita em badge (não mais texto pequeno ao lado do label)
`setDelta()` (`js/leads.js`) ganhou um modo badge só para `delta-receita` (`elId === 'delta-receita'`):
fundo colorido (`rgba(verde/vermelho,0.12)`) + texto completo "▲ 18% vs. período anterior", em vez do
"▲ 18%" pequeno que os outros 4 cards continuam usando. Mesma função, output condicional — não
duplicou lógica de cálculo de variação.

### 4. Espaçamento por seção, não uniforme
Nova classe `.report-section` (`margin-bottom:32px`) envolve cada bloco temático (Resumo, Evolução,
Horários, Origem, Funil); dentro de cada seção o espaçamento continua o `gap` original dos grids
(14-16px). Antes tudo usava o mesmo `margin-bottom` plano, sem diferenciar "descanso entre temas" de
"espaço dentro de um tema".

### Onde estão as classes novas
`css/dashboard-base.css` (`.report-hero`, `.report-hero-main`, `.report-hero-side`,
`.report-hero-mini`, `.report-strip`, `.report-section-title`, `.report-section`) — todas construídas
só com tokens já existentes (`--blue`, `--card`, `--border`, `--muted`, `--radius-*`), nenhuma cor
nova. Breakpoints 960px/768px já existentes ganharam regras extras pros blocos novos (hero empilha em
1 coluna, strip cai pra 2 colunas).

> ⚠️ `css/dashboard-base.css` não é linkado direto no `index.html` — é importado via `@import` dentro
> de `css/dashboard.css` (`@import url("./dashboard-base.css?v=...")`). Editar `dashboard-base.css`
> exige bumpar o `?v=` **desse `@import`** E o `?v=` do próprio `dashboard.css?v=...` no `index.html`
> (o navegador cacheia os dois separadamente) — só um dos dois não basta.

## 📊 Seletor de tipo de gráfico (bar/pizza) nos Relatórios (2026-07-26)

Os 6 gráficos de distribuição da aba Relatórios (Campanhas, Conjuntos, Anúncios, Plataformas,
Anúncios/Vendas, Plataformas/Vendas) ganharam um mini-toggle **Barras ⇄ Pizza** no canto do título
(`.chart-type-toggle`), com a escolha **persistida no navegador** (`localStorage`, chave
`wt_report_chart_types`) — mesmo padrão já usado em `wt_metrics_cfg` (config de métricas de Ads).

### Como funciona
- `criarGrafico(canvasId, legendId, mapa, tipo)` (`js/leads.js`) passou a guardar o `mapa`/`legendId`
  de cada canvas em `_reportChartLastData` — permite **re-renderizar o gráfico ao trocar o tipo sem
  refazer o agrupamento dos dados** (`agrupar()` não roda de novo, só `criarGrafico` de novo com o
  mesmo `mapa` e o novo `tipo`).
- `getReportChartTypes()` lê do `localStorage` com fallback pros defaults originais
  (`REPORT_CHART_DEFAULTS`: Campanhas/Conjuntos/Anúncios-Vendas em barra, o resto em pizza — o mesmo
  comportamento de antes da feature).
- `trocarTipoGrafico(canvasId, tipo)` salva a escolha e chama `criarGrafico` de novo com o tipo novo.
- `montarChartTypeToggles()` desenha os 2 botões (ícones `chart-column`/`chart-pie`) em cada
  `.chart-type-toggle` do HTML e marca o ativo — chamada ao final de `renderRelatorios()` (depois dos
  6 `criarGrafico`, pra já nascer com o estado salvo refletido).
- `criarGrafico` também alterna a classe `.bar` no `.canvas-wrap` do canvas (`wrap.classList.toggle`)
  — essa classe controla o aspect ratio do card (barra é retangular, pizza é quadrada via
  `.canvas-wrap` vs `.canvas-wrap.bar` no CSS). Sem isso, trocar pra pizza manteria o formato de barra.

### ⚠️ Nomes de ícone lucide mudaram na v0.469.0 (pinada no projeto)
Os nomes antigos `bar-chart-3`/`pie-chart` (comuns em versões antigas do lucide, muito citados em
exemplos na internet) **retornam 404** na v0.469.0 usada aqui (`cdn.jsdelivr.net/npm/lucide@0.469.0`).
Os nomes corretos nessa versão são **`chart-column`** e **`chart-pie`** — confirmado via
`curl .../lucide-static@0.469.0/icons/<nome>.svg`. **Sempre validar o nome do ícone contra essa versão
antes de usar** (mesma lição já registrada para adicionar campo novo na API de Ads: não confiar em
exemplos genéricos, testar contra a versão real fixada no projeto).

### Escopo desta entrega
Só a aba Relatórios (os 6 gráficos de distribuição leads/vendas por campanha-conjunto-anúncio-
plataforma). O gráfico de Evolução Diária (linha do tempo) e o Heatmap de Horários não entraram —
são visualizações de série temporal/matriz, não fazem sentido como pizza. Meta Ads (cards/tabela)
também ficou de fora — usa outro pipeline de renderização (`getAdsMetricCellValue`), fora do escopo.

## 📱 Monitor de Conversas — toolbar de filtros no mobile (2026-07-26)

No celular, a barra de filtros da aba Conversas (`.chat-monitor-toolbar`: Cliente, Instância, Origem,
busca, nota de retenção, botão Atualizar) ficava **sempre visível no topo**, inclusive quando o
usuário já estava dentro de uma conversa — competindo por espaço vertical com a área de mensagens,
que é o que mais importa numa tela pequena.

### O que mudou
1. **Toolbar some ao entrar numa conversa/no painel de lead.** `chatMobileShowThread()` e
   `chatMobileShowLead()` (`js/chat-monitor.js`) passaram a espelhar as classes `mobile-show-thread`/
   `mobile-show-lead` também em `#aba-conversas` (não só em `#chatMonitorShell`, que já tinha esse
   controle antes). O CSS (`dashboard-base.css`, bloco `@media(max-width:1180px)`) usa isso pra
   esconder `.chat-monitor-toolbar` e dar mais altura ao `.chat-monitor-shell` nesses dois estados.
   `chatMobileShowList()` (botão "voltar") remove as classes dos dois lados e a toolbar volta.
2. **Instância e Origem lado a lado.** Na tela de lista de conversas (onde a toolbar continua
   visível), os selects `#chatInstanceFilter`/`#chatOrigemFilter` dividem a mesma linha
   (`calc(50% - 4px)` cada) em vez de empilhar um embaixo do outro — Cliente (só admin) e a busca
   continuam em linha própria por serem mais largos/importantes de ler por completo.

### Por que espelhar a classe em vez de usar `:has()`
`.chat-monitor-toolbar` e `.chat-monitor-shell` são elementos **irmãos** no DOM (a toolbar vem antes
do shell) — não dá pra alcançar a toolbar a partir de uma classe no shell com seletores CSS comuns.
Em vez de `:has()` (suportado, mas menos legível/depurável), o JS simplesmente aplica a mesma classe
no pai comum (`#aba-conversas`), e o CSS lê dali. Mesmo padrão de "estado replicado no pai" já usado
noutros pontos do projeto para casos de irmãos não-adjacentes.

### Não afeta o modal de conversa aberto a partir de Leads
`abrirConversaDoLead()`/`fecharConversaModal()` (`js/leads.js`) movem `.chat-thread-panel` para
`#chatModalSlot`, **fora** de `#aba-conversas` — usam `display:flex` no overlay diretamente, sem
depender das classes `mobile-show-*`. A mudança não toca nesse fluxo.

### "Já abre a conversa sozinho" no mobile — não era cache, era auto-select intencional
Ao entrar na aba (ou trocar o filtro de Origem), `chatLoadConversations()` sempre auto-selecionava a
**1ª conversa da lista** (`if (!stillExists && conversations.length) await chatSelectConversation(0)`)
— decisão original pensada pro desktop, onde os 3 painéis convivem lado a lado e abrir a 1ª conversa
de cara é conveniente. No mobile, como os painéis viram telas cheias empilhadas (`mobile-show-thread`
troca a lista pela thread), esse auto-select pulava direto pra dentro de uma conversa sem o usuário
clicar em nada, escondendo a lista — sensação de "já abre a conversa" / bug de cache, mas era
comportamento determinístico do código.

**Correção:** `chatIsMobileLayout()` (novo helper, `window.matchMedia('(max-width: 1180px)')` — mesmo
breakpoint do CSS responsivo) guarda os 2 pontos de auto-select (`chatLoadConversations` e o listener
de `#chatOrigemFilter`). No mobile, em vez de `chatSelectConversation(0)`, chama `chatRenderEmptyThread()`
+ `chatMobileShowList()` (garante voltar pra lista mesmo se uma thread antiga estava aberta antes da
troca de filtro). **No desktop o comportamento não mudou** — continua auto-abrindo a 1ª conversa.

### Bug real: composer "gigante"/vazio no modal de conversa (popup de Leads) no mobile
Reportado com print comparando o WhatsApp real (caixa de texto compacta, só cresce com o conteúdo) com
o popup do painel (`abrirConversaDoLead`, aberto pelo botão verde na tabela de Leads) — no celular a
área acima do composer aparecia como um vazio branco enorme, muito diferente do padrão do WhatsApp.

**Causa:** o bloco `@media(max-width:1180px)` tinha `.chat-panel { position:absolute; inset:0; width:100%; }`
**sem escopo** — pensado só pro `.chat-monitor-shell` (onde os 3 painéis viram telas cheias sobrepostas
com `translateX`). Só que `.chat-thread-panel`/`.chat-lead-panel` são os **mesmos elementos DOM**
movidos para dentro de `#chatModalSlot` via JS quando o popup abre (`abrirConversaDoLead` em
`js/leads.js`, comentado como "preserva IDs e listeners"). No mobile essa regra genérica também
capturava o painel dentro do modal, e como `.chat-modal-slot` não tem `position:relative`, o
`position:absolute` "vazava" para o ancestral posicionado errado — quebrando a distribuição vertical
flex (mensagens ocupando espaço indevido, composer com altura inconsistente).

**Correção (`css/dashboard-base.css`):** todas as regras do bloco responsivo que só fazem sentido no
shell principal (`.chat-panel`, `.chat-panel + .chat-panel`, `.chat-list-panel`, `.chat-thread-panel`,
`.chat-lead-panel` e os `translateX`) passaram a ser escopadas com o prefixo `.chat-monitor-shell `.
**Regra geral daqui pra frente:** qualquer CSS responsivo novo para essas classes de painel do chat
deve ser escopado a `.chat-monitor-shell` (ou a `.chat-modal-slot`, se for exclusivo do modal) — nunca
`.chat-panel`/`.chat-thread-panel` soltos, porque os mesmos elementos vivem nos dois contextos.

### Limite de ~5 linhas no campo de mensagem já existe (não precisou de mudança)
O usuário também perguntou sobre o comportamento do WhatsApp real onde o campo de texto cresce até um
limite e depois passa a rolar internamente (texto mais antigo sai de vista pra cima). Isso **já estava
implementado** e funcionando: `.chat-composer-input` tem `max-height:124px` + `overflow:auto` +
`resize:none` (CSS), e o listener de `input` em `chatBindComposerEvents()` (`js/chat-monitor.js`) faz
o auto-grow via `input.style.height = Math.min(input.scrollHeight, 120) + 'px'`. Com `font-size:14px`/
`line-height:1.38`, isso corresponde a ~5.5 linhas antes de travar a altura e começar a rolar — mesma
faixa do WhatsApp nativo. Nenhuma mudança necessária aqui.

### Distância do composer até o teclado, comparado ao WhatsApp real
Print de comparação mostrou o composer do WhatsApp nativo colado quase direto na borda do teclado,
enquanto o painel tinha uma folga visível maior abaixo da caixa de texto quando o teclado abria no
celular. Causa: `.chat-composer` tinha `padding:12px 16px 14px` fixo, pensado pro estado de repouso
(sem teclado) — o padding-bottom de 14px sobrava como espaço morto acima do teclado.

**Correção:** dentro do bloco `@media(max-width:1180px)`, `.chat-composer` ganhou padding reduzido
(`8px 10px calc(6px + env(safe-area-inset-bottom, 0px))`) — o `env(safe-area-inset-bottom)` preserva
o respiro necessário pro home indicator do iPhone **só quando o teclado não está aberto** (a área seguro
some/reduz com o teclado ativo na maioria dos navegadores mobile), então não soma folga extra em cima
do teclado. Ainda não é pixel-perfect ao WhatsApp nativo (diferença de padding interno do
`.chat-composer-row`), mas reduz a distância visível na faixa que o print mostrou.

## 📱 Filtros da aba Leads em grid 2 colunas no mobile (2026-07-26)

Print mostrou os 6 controles da topbar (Cliente, Instância, Origem, Busca, Período, CSV) empilhados
1 por linha no celular, cada um ocupando a largura inteira da tela — a lista de leads só aparecia
depois de rolar bastante. Causa: `.ctrl-box`/`select.bare` não tinham `width` fixo, então cada um
ficava do tamanho do próprio conteúdo (ex: "Rodrigo Mendanha", "Todas instâncias"), e o
`flex-wrap:wrap` do `#filterControls`/`#leadsControls` quebrava linha sempre que não cabia mais um
item ao lado — na prática, 1 por linha na maioria dos casos.

**Decisão do usuário:** manter todos os filtros sempre visíveis (sem escondê-los atrás de um botão),
só compactar o layout — diferente da solução adotada no Monitor de Conversas (que colapsa a toolbar
completamente dentro de uma conversa, ver seção acima). Contextos diferentes: em Leads os filtros
continuam relevantes com a lista visível ao mesmo tempo; em Conversas, a thread aberta já basta.

**Correção (`css/dashboard-base.css`, bloco `@media(max-width:768px)`):**
- `#filterControls`/`#leadsControls` viram `display:grid; grid-template-columns:1fr 1fr` (2 colunas)
  em vez do `flex-wrap` que empilhava 1 por linha.
- `.ctrl-box { width:100% }` — cada filtro passa a ocupar a célula do grid, não o tamanho do próprio
  texto. Selects nativos truncam o texto selecionado automaticamente quando mais estreitos que o
  conteúdo (comportamento padrão do browser) — a opção completa aparece ao abrir o dropdown.
- `#adminClienteFilter` (nome do cliente, só admin) e `#areaPersonalizada` (datas do período
  personalizado) usam `grid-column:1 / -1` — ocupam a linha inteira, por serem mais longos/compostos.
- Resultado: 5-6 controles cabem em ~3 linhas em vez de até 6, empurrando bem menos a lista de leads
  pra baixo da dobra.

> **Superado pela seção seguinte** ("Topbar em 3 linhas no mobile") — o Cliente saiu do grid e voltou
> pra linha do título; o grid de 2 colunas descrito acima continua valendo só pra Instância/Origem/
> Busca/Período/CSV (`#leadsControls`), não mais pro `#filterControls` inteiro.

## 📱 Topbar em 3 linhas no mobile: título+Cliente / Tema / filtros (2026-07-27)

Refinamento do layout acima — o usuário pediu uma organização mais específica: **Cliente ao lado do
título** (não mais dentro do grid de filtros), **Tema sozinho numa linha**, e só o resto dos filtros
formando o grid. Vale **só no mobile** (desktop continua idêntico a antes) e **em todas as 9 abas**
que mostram o filtro de Cliente pra admin (`ABAS_COM_FILTRO_CLIENTE`, `index.html:3174`), não só Leads
— decisão confirmada com o usuário via AskUserQuestion.

### Mudança estrutural no HTML
`#adminClienteFilter` **saiu de dentro de `#filterControls`/`.topbar-right`** e virou filho direto de
`.topbar`, posicionado logo após a nova `.topbar-title-group` (classe adicionada à div do título — antes
era uma `<div>` sem classe, só com `style` inline). Confirmado via 2 agentes Explore antes de mover:
nenhum JS depende de posição/aninhamento desses elementos no DOM, só de `$('id')` — `trocarClienteAdmin`,
`atualizarVisibilidadeFiltroCliente` (`index.html:3180-3187`) e `mudarAba` continuam funcionando sem
alteração, porque todos acessam por id, não por relação de pai/filho.

### CSS desktop (fora de media query) — preserva o layout de antes
`.topbar` tem 3 filhos diretos agora: `.topbar-title-group`, `#adminClienteFilter`, `.topbar-right`.
Pra manter a aparência desktop idêntica à anterior (Cliente dentro do grupo da direita, colado no
resto dos filtros), usa `order` + `margin-left:auto`:
```css
.topbar { justify-content:flex-start; /* era space-between */ }
.topbar-title-group { order:1; }
.topbar #adminClienteFilter { order:2; margin-left:auto; }
.topbar-right { order:3; }
```
O `margin-left:auto` no Cliente empurra ele (e tudo depois, via `order`) pra direita, reproduzindo o
`space-between` visual sem abrir um gap indevido entre o título e o Cliente quando ambos os grupos
"da direita" (Cliente + topbar-right) estão perto um do outro.

### CSS mobile (`@media(max-width:768px)`) — as 3 linhas
- **Linha 1**: `.topbar-title-group` (`flex:1 1 auto`, encolhe) + `#adminClienteFilter`
  (`flex:0 0 auto`, `max-width:118px`) — mesma linha do wrap. O `<h1>` do título ganhou
  `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` (antes não tinha — sem isso o título
  "Leads"/nome de outras abas não truncava, e um `min-width:0` sozinho nos containers pais não é
  suficiente pra fazer um elemento de texto truncar, precisa do trio completo no próprio elemento de
  texto). `#selectClienteAdmin` ganhou `max-width:80px` — trunca o nome do cliente (dropdown mostra
  completo ao abrir, comportamento nativo do `<select>`).
- **Linha 2**: `.topbar-right` com `order:3; flex:1 1 100%` — força quebra de linha própria, sobra só
  `.refresh-badge` (oculto em telas ≤480px por regra já existente) + `#btnTheme`.
- **Linha 3+**: `#filterControls` (`order:4; flex:1 1 100%; display:block`) só serve de wrapper agora —
  tem 1 filho só (`#leadsControls`, já que o Cliente saiu). Quem é o grid de 2 colunas de verdade é
  **`#leadsControls`** diretamente (antes era `#filterControls` E `#leadsControls` juntos, um grid
  dentro do outro com um único item — desperdiçava metade da largura; corrigido nesta mudança).

### Armadilha real encontrada e corrigida: regra antiga conflitante
Existia uma regra **pré-existente**, dentro do mesmo bloco `@media(max-width:768px)` mas ~100 linhas
abaixo (seção "Leads controls: wrap full width"): `#adminClienteFilter { min-width:170px; }`. Como
estava depois no arquivo, vencia em empate de especificidade sobre o `max-width:118px` novo — um
`min-width` maior que o `max-width` força o `min-width` a vencer (regra do box model), estourando a
largura calculada pra caber ao lado do título. Removida junto com 2 regras órfãs do mesmo bloco
(`#selectClienteAdmin { min-width:125px; max-width:190px; }` e `#leadsControls { width:100% }`
duplicado) que pertenciam ao layout antigo (Cliente dentro do grid) e não faziam mais sentido.
**Lição:** ao adicionar uma regra pra um id/classe já existente no CSS, sempre `grep` o nome completo
primeiro — regras conflitantes no mesmo media query, especialmente longe uma da outra no arquivo, são
fáceis de não perceber e o efeito (min-width vencendo silenciosamente) não é óbvio no código, só no
resultado renderizado.

### `min-width:0` em cascata — por que cada nível do grid precisa dele
Confirmado por trial-and-error com `getBoundingClientRect()`: um item de grid/flex **não encolhe além
do tamanho do próprio conteúdo por padrão** (`min-width:auto` implícito), mesmo com `width:100%`
declarado. `#leadsControls`, `#filterControls` e `.ctrl-box` (mais `input[type=text/search]` dentro
dela) todos precisaram de `min-width:0` explícito — sem isso em qualquer um desses 3 níveis, o texto
mais longo de uma opção de select (ex: "Todas instâncias") força a célula do grid a estourar a coluna,
e como `.main { overflow:hidden }` esconde o excesso sem scroll, o sintoma é conteúdo cortado/ausente
sem nenhum erro visível — parece bug de renderização, mas é só a regra de encolhimento padrão do CSS.

### Nota de ferramenta: `--window-size` do Chrome headless não confiável neste ambiente
Durante a verificação visual desta mudança, o Chrome headless (`--headless=new`) neste ambiente Windows
sempre reportou `window.innerWidth=500`, **independente** do `--window-size` pedido (testado 375, 390,
800) ou do `<meta name="viewport">` (testado `device-width` e `width=340` fixo). Não é cache (testado
com `user-data-dir` novo, nome de arquivo novo, `--disable-cache` — resultado idêntico byte-a-byte).
Sem `puppeteer`/`playwright`/`ws` instalados no projeto pra usar CDP via WebSocket e contornar isso.
**Solução usada:** validar a matemática do CSS via `getComputedStyle`/`getBoundingClientRect` (dados
reais do motor de layout, confiáveis independente do bug de screenshot) confirmando `FITS` em 500px
(ainda dentro do breakpoint mobile de 768px), mais um cálculo manual reproduzindo as mesmas contas pra
375px (a menor largura de celular comum) — resultado: cabe com folga (343px disponíveis vs. 166px
mínimo necessário). A screenshot "vazia"/sem o elemento em telas menores era o próprio overlay de
debug (`position:fixed; z-index:99999`) cobrindo a topbar, não um bug de CSS — confirmado removendo o
overlay e testando limpo em 500px, onde o layout apareceu perfeito.

## 🔗 Link público de conexão WhatsApp — QR renovado automaticamente (2026-07-27)

O link público (`wa-connect.html`, gerado por "Compartilhar" na aba Conexão WhatsApp — pensado pra
mandar pra quem tem o celular físico, sem dar acesso ao painel) expirava em **60s fixos**, tempo
curto demais na prática: a pessoa recebia o link, precisava abrir, entender as instruções e escanear
tudo dentro desse minuto, senão via "Este link expirou. Peça um novo link." mesmo sem ter feito nada
de errado.

### Causa raiz
O link só espelhava uma **imagem estática** do QR (a mesma capturada no momento do clique em
"Compartilhar" no painel) — sem o auto-refresh que a tela normal do painel tem
(`checkWaStatus(true)` em `js/admin.js`, que busca um QR novo sozinho quando o atual expira). Como o
QR real do WhatsApp também expira rápido (~60s, estimativa de UX — a Evolution não retorna
expiração real), o link precisava morrer nesse mesmo intervalo pra não mostrar um código morto sem
avisar.

### Correção: separar validade do LINK da validade do QR individual
`api/wa-connect-public.js` agora distingue dois tempos:
- **`WA_QR_TTL_SECONDS = 60`** — quando o QR atual fica velho. Ao vencer, o próprio endpoint busca
  um QR **novo** direto na Evolution (`GET /instance/connect/{instance}`, mesma chamada que
  `api/evo-manager.js` usa no painel) e atualiza `qr_base64`/`created_at` no banco — tudo
  server-side, a chave da API nunca é exposta ao público.
- **`WA_LINK_TTL_SECONDS = 15 * 60`** (15 minutos) — quando a página inteira para de funcionar
  de vez. Substituiu o antigo `WA_QR_TTL_SECONDS` de 60s que controlava isso antes.

`api/wa-connect-share-create.js` (cria o link) usa `WA_LINK_TTL_SECONDS` pro `expires_at` gravado —
mesma constante duplicada nos dois arquivos (comentário cruzado pra manter em sincronia, mesmo
padrão já usado entre `js/admin.js`/`api/wa-connect-share-create.js` antes desta mudança).

### Resposta da API mudou de `expires_at` único para dois campos
`qr_expires_at` (quando a imagem atual fica velha — renova sozinha no próximo poll) e
`link_expires_at` (quando a página para de funcionar). `js/wa-connect-public.js` foi atualizado:
- Countdown mostra `qr_expires_at` ("Código válido por mais X:XX" — texto trocado de "Expira em",
  já que agora renovar é automático, não é mais uma ameaça de fim de sessão).
- Ao vencer o countdown do QR, não trava mais em "Expirado" — mostra "Renovando código..." e o
  polling de 4s (`setInterval` já existente) pega a imagem nova do backend no próximo ciclo.
- **Nova função `atualizarQrSeMudou(data)`**: como agora a imagem pode trocar no meio da sessão
  (antes nunca trocava, só existia 1 render), o polling compara `data.qr_base64` com o último
  renderizado — só re-renderiza o `<img src>` quando muda de verdade, sem re-montar o HTML inteiro
  (evita piscar a cada poll de 4s).

### Não migra links antigos
`expires_at` de links já criados antes do deploy continua valendo a estimativa antiga (~60s desde a
criação) até expirarem — sem UPDATE retroativo no banco. Só links criados depois do deploy usam os
15 minutos novos.

## 🐛 Funil de Vendas — card "Origem das Conversas" nunca contava Google Ads (2026-07-27)

O card "Origem das Conversas" (aba Funil) sempre mostrava **Google Ads: 0**, mesmo com leads
claramente vindos do Google (confirmado com um cliente real: 47 conversas Meta + 36 "Outras", 0
Google — mas a aba Leads do mesmo cliente/período mostrava vários leads com `plataforma: Google`
via link rastreável).

### Causa raiz
`api/metrics-funnel.js` classificava a origem comparando **`lead_origin = 'google'`** — só que
`lead_origin` é sobre o **mecanismo de captura** (`ctwa`, `organic`, `bio`, `campaign_link`,
`rotator`, `intelligent` — ver `obterOrigemLead()` em `js/leads.js`), **nunca** sobre a plataforma de
anúncio. Um lead vindo de um anúncio do Google Ads via link rastreável tem `lead_origin =
'campaign_link'`, igual a um lead vindo de um anúncio do Meta pelo mesmo mecanismo — a diferença
entre as duas plataformas está em **`plataforma`** (coluna do banco) ou, se vazia, no **`utm_source`**
(fallback). Resultado: `lead_origin = 'google'` nunca era verdadeiro → Google Ads sempre 0, e todo
lead do Google caía no bucket "Outras Origens" (não era `ctwa` nem `'google'`, mas tinha uma origem
rastreada válida).

### Correção
A query SQL de `timelineQ` (`api/metrics-funnel.js`) foi reescrita pra replicar o **mesmo critério
já usado na coluna Plataforma da tabela de Leads** (`js/leads.js`, dentro de `renderTabela()`):
- **Meta Ads**: `lead_origin = 'ctwa'` (CTWA é sempre Meta) OU `plataforma` em
  `facebook`/`instagram` OU (`plataforma` vazia E `utm_source` contém `fb`/`face`/`ig`/`insta`).
- **Google Ads**: `plataforma = 'google'` OU (`plataforma` vazia E `utm_source` contém
  `google`/`adwords`) — sempre excluindo CTWA (nunca pode ser Google).
- **Outras Origens**: tem `lead_origin` rastreado (não é nulo/vazio/`organic`) mas não bateu em
  nenhum critério de Meta nem Google acima.
- **Não rastreadas**: `lead_origin` nulo/vazio/`organic` — comportamento que já estava correto,
  não mudou.

As 4 categorias são **mutuamente exclusivas e exaustivas** (validado com 12 casos de teste em Node,
espelhando a tradução SQL antes de aplicar) — todo lead cai em exatamente 1 bucket, nunca em 0 nem em
2+. Sem acesso ao banco de produção neste ambiente para testar a query real; validação feita via
simulação da lógica equivalente em JS puro.

> Mesma armadilha do tipo já documentado alhures neste arquivo: **nunca assumir que um campo tem um
> valor só porque "faria sentido"** — sempre conferir contra `obterOrigemLead()`/os valores reais
> gravados pelo webhook antes de escrever um filtro. `lead_origin` e `plataforma` são conceitos
> diferentes (mecanismo de captura vs. rede de anúncio) e não devem ser confundidos em nenhuma query
> nova que precise diferenciar Meta de Google.

## 🐛 Funil de Vendas — card "Comprou" divergia do card "Total de Vendas" (2026-08-11)

Na aba Funil, com o período "Hoje e Ontem", o card **"Comprou"** (dentro de "Funil da Jornada de
Compra") mostrava um número diferente do card **"Total de Vendas"** (dentro de "Faturamento Total"),
apesar de ambos os cards estarem na mesma tela sob o mesmo seletor de período.

### Diagnóstico — confirmado com SQL direto no banco (não só leitura de código)
O usuário rodou 3 queries no banco de produção comparando os dois critérios lado a lado. Resultado
real: 3 vendas fecharam no período (`sale_closed_at` dentro de "hoje e ontem"), mas os leads por trás
delas tinham `created_at` em datas diferentes — um deles (`Big Frio Climatização`) **entrou 8 dias
antes** (`created_at = 03/08`) e só fechou a venda no dia 11/08. Confirma que a causa era ciclo de
venda mais longo que a janela do período, não um bug de cálculo.

### Causa raiz
`api/metrics-funnel.js`, `overviewQ`: **todas** as métricas (`total_leads`, `qualified`, `sales`, etc.)
vinham do mesmo `SELECT` filtrado por `WHERE ${leadsPeriodWhere}` — ou seja, por `created_at` (quando
o **lead entrou**). Fazia sentido pro topo do funil (quantos leads chegaram), mas `sales` (usado no
card "Comprou") deveria responder "quantas vendas **fecharam** no período" — a mesma pergunta que o
card de Faturamento ao lado já respondia corretamente via `salesQ` (filtrado por `sale_closed_at`).
Um lead que entrou fora do período mas comprou dentro dele nunca era contado em "Comprou", mesmo
aparecendo certinho no card de Faturamento — os dois cards, lado a lado, respondiam perguntas
diferentes sem avisar isso ao usuário.

### Correção
`sales` foi tirado do `SELECT` de `overviewQ` e movido para uma query separada (`salesCountQ`),
filtrada por `${salesPeriodWhere}` (o mesmo `sale_closed_at` que `salesQ` já usa) — reaproveita o
mesmo `cliWhere`/`params` do resto do handler. `overviewQ.rows[0].sales` é atribuído depois, antes de
montar a resposta. As demais métricas de `overviewQ` (`total_leads`, `untracked`, `first_contact`,
`qualified`, `proposal_sent`) **continuam filtradas por `created_at`** — de propósito, já que são
sobre entrada de lead, não sobre fechamento de venda.

Validado com os dados reais confirmados no banco (simulação em Node reproduzindo os 3 leads e as
datas exatas): antes da correção o card contaria 1-2 vendas dependendo do timezone exato do corte;
depois da correção, bate exatamente com os 3 confirmados no banco.

### Efeito colateral aceito (não é bug)
`js/funil.js` (`_funilRenderJornada`) calcula `% dos leads` e `% Conversão` como `sales / total_leads`
e `sales / first_contact`. Como agora `sales` conta por uma janela de tempo diferente da base
(`total_leads`/`first_contact`, que contam por `created_at`), esses percentuais podem soar estranhos
em períodos com ciclo de venda longo (ex: teoricamente passar de 100% se muitas vendas de leads
antigos fecharem num período curto). Decisão deliberada: melhor ter o número absoluto de vendas
correto (e consistente com o card de Faturamento) do que uma % "bonita" calculada sobre uma base que
não representa de fato os compradores daquele período. Não alterado nesta correção — fora do escopo
do que foi pedido.

## 🐛 Editar Cliente: trocar senha não fazia nada em clientes sem usuário vinculado (2026-08-11)

Admin trocava a senha de um cliente ("Frigorífico o Eron") pelo modal Editar Cliente, via
"Cliente atualizado!" (sucesso), mas o login continuava dando "Email ou senha incorretos" — com
**qualquer** senha, não só a nova.

### Diagnóstico — confirmado com SQL direto no banco
```sql
SELECT u.id AS usuario_id, u.email, u.is_admin, u.cliente_id, c.id AS cliente_id_real, c.nome
FROM clientes c LEFT JOIN usuarios u ON u.cliente_id = c.id
WHERE c.nome ILIKE '%Eron%';
```
Resultado: `usuario_id = NULL`. O cliente existia em `clientes`, mas **não tinha nenhuma linha em
`usuarios`** — provavelmente criado fora do fluxo normal (script/migração antiga), já que o `POST`
de criação de cliente sempre cria os dois juntos (`clientes` + `usuarios`, ver linhas 45-67).

### Causa raiz
`api/clientes.js`, método `PATCH`: o e-mail e a senha eram atualizados só via `UPDATE usuarios SET
... WHERE cliente_id=$2 AND is_admin=false` — **sem checar `rowCount`**. Quando não existe usuário
pra aquele `cliente_id`, o `UPDATE` afeta 0 linhas silenciosamente, e o handler retornava sucesso
igual, mascarando completamente o problema. É a mesma classe de bug do card do Funil corrigido
acima (efeito colateral silencioso de uma query que não afeta o que deveria) — **sempre checar
`rowCount`/`RETURNING` em `UPDATE`s que o resto do fluxo assume terem funcionado**.

### Correção
- `api/clientes.js` (`PATCH`): agora guarda o `rowCount` dos `UPDATE`s de e-mail/senha. Se nenhum
  afetou nenhuma linha **e** uma senha foi informada, **cria o usuário do zero** (mesmo INSERT do
  fluxo `POST`), usando o e-mail do próprio formulário (`email_contato` sempre vem preenchido do
  campo da tela, mesmo sem edição — confirmado em `js/admin.js:239`). Se não houver e-mail
  suficiente pra criar (caso raro), a resposta volta com `senha_salva: false` e uma mensagem
  explicando exatamente o que falta, em vez de fingir sucesso.
- `js/admin.js` (`salvarEdicaoCliente`): antes **ignorava `data.message`** do backend e sempre
  mostrava o texto fixo "Cliente atualizado!" — por isso o aviso de senha não salva nunca chegava a
  aparecer, mesmo que o backend já soubesse do problema. Agora usa `data.message` (com fallback pro
  texto genérico) e mostra como erro (`toast(..., 'error')`) quando `senha_salva === false`.

### Como confirmar que outros clientes não têm o mesmo problema
```sql
SELECT c.id, c.nome, c.email_contato
FROM clientes c
LEFT JOIN usuarios u ON u.cliente_id = c.id AND u.is_admin = false
WHERE u.id IS NULL AND c.archived_at IS NULL;
```
Clientes que aparecerem aqui nunca conseguiram logar, independente de quantas vezes a senha foi
"salva" pelo painel antes desta correção — a próxima vez que um admin salvar e-mail+senha pelo
modal Editar Cliente, o usuário é criado automaticamente (não precisa de script de migração à parte).

## 🔍 Diagnóstico de tokens Meta — cada token só enxerga as contas do seu Business Manager

Durante a investigação do bug acima, vários tokens de acesso da Meta foram testados diretamente
contra a Graph API (`GET /v20.0/me/adaccounts`) pra diagnosticar problemas de "Nenhuma conta
vinculada" em clientes específicos. Lição confirmada com dados reais, útil pra qualquer investigação
futura do tipo: **um token da Meta só lista as contas de anúncio do Business Manager/usuário que o
gerou** — não existe "token universal" que enxergue todas as contas de todos os clientes da agência
automaticamente. Um token pode ser perfeitamente válido (`is_valid: true`, escopos corretos como
`ads_management`/`ads_read`/`business_management`) e ainda assim retornar 0 ou poucas contas, se
essas contas não tiverem sido compartilhadas com aquele System User específico no Business Manager.

- **`GET /v20.0/debug_token?input_token=X&access_token=X`** mostra `type` (`SYSTEM_USER` é o tipo
  recomendado pra integração server-side — não expira por troca de senha, diferente de token de
  usuário comum), `is_valid`, `expires_at`, `scopes`/`granular_scopes`. Útil pra confirmar rapidamente
  se um token tem os escopos certos antes de gastar tempo testando `me/adaccounts`.
- **`error_subcode 460`** (`code: 190`) — "The session has been invalidated because the user changed
  their password or Facebook has changed the session for security reasons." — token de usuário comum
  invalidado; não tem conserto via código, precisa gerar um token novo (idealmente `SYSTEM_USER`,
  que não sofre desse problema).
- Cada `token_meta_enc` de cliente (aba Meta Ads do modal Editar Cliente) deve ser o token **daquele
  Business Manager específico** — colar um token de outro cliente/agência ali não funciona mesmo que
  o token seja válido, porque ele não vê a conta configurada em `clientes.account_id` daquele cliente.

## 💰 Alerta de saldo baixo na conta de anúncios Meta (WhatsApp) — 2026-08-11

Novo cron que avisa o admin via WhatsApp quando o saldo de uma conta de anúncios Meta fica abaixo
de um limite configurável por cliente. Campo `balance` (saldo pré-pago disponível, minor unit —
centavos) confirmado via teste real contra a Graph API durante a investigação de tokens acima —
`GET act_{id}?fields=name,balance,currency`.

### Decisões do usuário (via AskUserQuestion)
- Monitora **todas** as contas com `account_id` configurado (não uma lista manual à parte).
- Destino do alerta é **um único número/grupo fixo do admin da agência** — não por cliente. Todos os
  alertas de saldo de todos os clientes chegam no mesmo WhatsApp.
- Limite de saldo é **configurável por cliente** (contas grandes e pequenas têm escalas diferentes).
- Checagem a cada **6 horas**.

### Arquivos
- `api/cron/check-ads-balance.js` (novo) — `runCheckAdsBalance()`: varre `clientes` com
  `account_id` E `saldo_alerta_minimo` preenchidos, busca `balance` na Graph API (token do cliente
  via `token_meta_enc`/`token_meta`, fallback `META_ADS_TOKEN` global — mesma cascata de
  `getTokenForUser`), compara com o limite e envia `POST {EVOLUTION_API_URL}/message/sendText/
  {instance}` (mesmo endpoint/padrão de `api/cron/send-reports.js`) quando estiver abaixo.
- `server.js`: `iniciarCronCheckAdsBalance()` registra o `setInterval` de 6h (mesmo padrão de
  `iniciarCronZap`/`iniciarCronChatCleanup`) e roda uma vez já na subida do servidor (`tick()` fora
  do interval), não só depois de 6h — evita ficar até 6h sem checar após um deploy/restart.
- `api/_tracking-schema.js`: 2 colunas novas em `clientes` — `saldo_alerta_minimo NUMERIC(12,2)`
  (limite em reais; `NULL`/`0` = alerta desativado para o cliente) e `saldo_alerta_disparado_em
  TIMESTAMP` (controle de anti-spam). O próprio `check-ads-balance.js` também roda o mesmo `ALTER
  TABLE ... ADD COLUMN IF NOT EXISTS` no início da função — não depende só de `ensureTrackingSchema()`
  ter rodado antes (mesmo padrão defensivo já usado nesta parte do projeto).
- `api/clientes.js` (`PATCH`): aceita `saldo_alerta_minimo` — string vazia desativa (`NULL`), número
  ativa/atualiza **e zera `saldo_alerta_disparado_em`** (evita perder um alerta se o saldo já estiver
  abaixo do valor novo configurado). `GET` inclui a coluna na listagem pro front conseguir
  pré-preencher o campo ao abrir o modal.
- `index.html`: campo "Alerta de saldo baixo (R$)" na aba Meta Ads do modal Editar Cliente, logo
  abaixo de "ID da Conta de Anúncios".
- `js/admin.js`: `abrirEditCliente`/`salvarEdicaoCliente` leem/escrevem o campo novo.

### Anti-spam
Um alerta por cliente a cada 24h enquanto o saldo continuar abaixo do limite (mesmo rodando o cron
a cada 6h). Quando o saldo volta a ficar acima do limite, `saldo_alerta_disparado_em` é zerado —
permite alertar de novo se cair abaixo outra vez no futuro (não é um "alertou uma vez, nunca mais").

### Escopo desta entrega
Só a Meta Ads — Google Ads não tem um campo equivalente de saldo simples exposto sem OAuth2/
developer token (mesma limitação já documentada na seção "Conversão Google Ads no link rastreável").
Não implementado nesta entrega.

### Destino do alerta configurável pelo painel (evolução — substitui as env vars)
A primeira versão usava `ALERTA_SALDO_INSTANCE`/`ALERTA_SALDO_DESTINO` fixas no `.env`. Substituído
por um seletor na aba **Configurações** (`aba-ajustes`, admin-only, junto do White-label) — mesmo
padrão de Instância → Grupo/Contato já usado no modal de Relatórios Automáticos (`zapModal*`), só
que **uma configuração ÚNICA e global** (não por cliente/campanha).

- `api/alerta-saldo-config.js` (novo) — `GET`/`PATCH`, admin-only. Guarda 4 chaves na tabela
  genérica `configuracoes_sistema` (chave/valor, já usada pelo white-label em
  `api/config-update.js`): `alerta_saldo_instance`, `alerta_saldo_tipo` (`grupo`/`contato`),
  `alerta_saldo_destino_jid`, `alerta_saldo_destino_nome` (só para exibição). Reaproveitar essa
  tabela evitou criar uma nova só para 4 valores — diferente de `zap_destinos`, que é por cliente e
  tem volume que justifica tabela própria.
- `api/cron/check-ads-balance.js`: `getDestinoAlerta(pool)` lê essas 4 chaves; se não encontrar
  (nunca configurado pelo painel), cai no **fallback das env vars antigas**
  (`ALERTA_SALDO_INSTANCE`/`ALERTA_SALDO_DESTINO`) por retrocompatibilidade — quem já tinha
  configurado via `.env` continua funcionando sem precisar reconfigurar pelo painel.
- `index.html`: seção "Alerta de Saldo de Anúncios" na aba Configurações (`#alertaSaldoCard`,
  visível só pra admin, mesmo `if (user.is_admin)` que revela o `#whiteLabelCard`). Funções
  `alertaSaldoOnTipoChange`/`alertaSaldoOnInstanciaChange`/`salvarAlertaSaldoConfig` espelham as
  `zapOnTipoChange`/`zapModalOnInstanciaChange`/`salvarZapDestino` já existentes, reaproveitando
  `_popularGruposSelect()` (função global) para não duplicar a lógica de listar grupos da Evolution.
  Carregado ao entrar na aba `ajustes` (`carregarAlertaSaldoConfig()`, chamada em `mudarAba`).

> As env vars antigas continuam funcionando como fallback — não é obrigatório reconfigurar pelo
> painel se já estava funcionando via `.env`, mas o painel é a forma recomendada daqui pra frente
> (mesma razão de Relatórios Automáticos ter migrado de env fixa para seletor: menos deploy, mais
> autonomia do admin pra trocar o destino sem mexer em código/infra).

### Correção visual: separado da seção Marca/White-label
`#alertaSaldoCard` já era uma `<div>` irmã de `#whiteLabelCard` no HTML (não filha) — mas sem
nenhuma separação visual forte (só `margin-top`), parecia fazer parte do mesmo bloco "Personalização
da Marca" ao renderizar. Adicionado um `<hr>` explícito entre as duas seções dentro da aba
Configurações — mesma aba (só-admin), mas visualmente claro que são configurações independentes.

## ⚡ Link Direto sem delay (`?direct=1`) — mesmo slug, dois comportamentos (2026-08-12)

O redirecionador `/r/<slug>` sempre passava por uma página HTML intermediária antes de abrir o
WhatsApp (300ms sem Pixel, 1.4s com Pixel — tempo pro Pixel/gtag do navegador disparar). Usuário
queria um modo "clicou, já abre" pro link colado em botões de site — igual ao Tintim — mas **sem
perder** a telinha com Pixel no link usado em anúncios (Meta/Google Ads), que é o mesmo slug.

### Tentativa 1 (revertida): checkbox por campanha
Primeira versão adicionou um checkbox "Link sem delay" + coluna `tracking_campaigns.no_delay_redirect`
— mas isso forçava a escolha **pro slug inteiro**: ativar sem delay pra usar num botão de site também
tirava a telinha do mesmo link quando colado no Meta Ads. Usuário esclareceu que os dois usos
(anúncio com telinha + botão de site sem telinha) precisavam conviver **no mesmo link/campanha ao
mesmo tempo** — impossível com uma flag salva na campanha. Checkbox e coluna removidos do fluxo (a
coluna `no_delay_redirect` ficou no schema por segurança — não é apagada em produção — mas não é mais
lida por nenhum endpoint).

### Solução final: parâmetro na URL, não configuração salva
- `api/redirect.js`: quando a URL tem **`?direct=1`**, responde **`302 Location: waUrl`** direto —
  sem chamar `htmlPagePixel()`, sem servir HTML nenhum. `if (req.query.direct === '1')`, logo antes
  do `res.writeHead(200, ...)` que monta a página normal. Sem o parâmetro (comportamento padrão),
  segue exatamente como sempre foi.
- `js/captacao.js` (`capAtualizarScriptSnippet`, aba "Script para site" do modal de link): o campo
  **"Link de Rastreamento Direto (URL)"** gera `${origin}/r/${slug}?direct=1` — sempre, sem
  configuração nenhuma pra ativar. O link que você copia pra colar no Meta/Google Ads continua sendo
  `${origin}/r/${slug}` (sem o parâmetro, com telinha) — **mesmo slug, duas URLs, dois
  comportamentos, coexistindo**.
- **O que continua funcionando com `?direct=1`:** registro do clique em `tracking_clicks` (UTMs, IP,
  geo, `ad_id`/`adset_id`/etc.), o token invisível na mensagem, a atribuição do lead quando ele
  responder no WhatsApp, e o **CAPI Web PageView server-side** (`enviarCapiWebPageView`, que já
  roda antes da resposta HTTP de qualquer forma — não depende de HTML/JS no navegador).
- **O que NÃO dispara com `?direct=1`:** o Pixel do Meta e a conversão do Google Ads **do navegador**
  (`fbq('track','PageView')`/`gtag(...)`) — eles só existem dentro da página HTML que deixa de ser
  servida. Trade-off aceito: o link usado em botão de site normalmente não tem Pixel configurado de
  qualquer forma (quem quer Pixel completo em site usa o `wapptrack.js`, ver abaixo).

### Por que não reaproveitar o mecanismo do `wapptrack.js`
`js/wapptrack.js` (script de site externo) já é "sem delay real" — o clique chama
`/api/site-whatsapp-click` via JS e abre o WhatsApp na hora, sem nenhuma página intermediária, e
com Pixel completo (client-side, dispara antes do redirect). Mas isso é um mecanismo **client-side
via script**, não uma URL estática pronta pra colar num `href` puro. O `?direct=1` cobre o caso mais
simples (link estático em botão sem instalar script nenhum) — quem precisa de Pixel/PageView
completo em site usa o `wapptrack.js`, que já resolve isso melhor.

### Nomenclatura da aba (revertida)
A aba do modal de link foi renomeada de "Script para site" pra "Link Sem Delay / Script" e depois
"Link de Rastreamento Sem Delay" durante a iteração — **revertida pro nome original "Script para
site"** a pedido do usuário. O nome da aba não precisa descrever o comportamento sem delay porque
isso já é automático no campo "Link de Rastreamento Direto" dentro dela, sem exigir nenhuma ação
extra do usuário.

