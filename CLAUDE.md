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
