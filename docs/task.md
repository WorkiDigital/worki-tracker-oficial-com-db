# Tasks — Worki Tracker Oficial

---

## ✅ Concluído / Histórico

### Blindagem de Segurança (Tokens Isolados)
Todos os endpoints de Ads refatorados para ler token via banco de dados:
`ads.js` · `ads-accounts.js` · `ads-best.js` · `ads-children.js` · `ads-demo.js` · `ads-placement.js` · `video-source.js` · `ad-preview.js`

### Evolution API Integrada
- Rota unificada `api/evo-manager.js` criada (substitui create, qrcode e status).
- Frontend da aba *Conexões WhatsApp* implementado no painel.

---

## 🏁 Em andamento

### Homologação Evolution (sem N8N — tudo nativo por código)
- `[x]` **Webhook das instâncias corrigido:** `api/evo-manager.js` lia `N8N_WEBHOOK_URL`, mas o `.env` definia o nome antigo enquanto o código esperava outro — a instância ficava sem webhook. Padronizado em `WEBHOOK_URL` (código + `.env` + `.env.example`), apontando para o endpoint nativo `api/webhook-evo.js`.
- `[x]` **N8N removido por completo:** apagados `api/webhook-n8n.js`, `N8N_WEBHOOK_PLAN.md` e os scripts órfãos `fix_webhooks.cjs`/`fix_syntax.cjs`/`revert_webhooks.cjs`; limpas as referências em `README.md`, `index.html`, `.env*` e `.claude/settings.json`. Todo o fluxo é nativo por código.
- `[ ]` Teste visual: gerar QR Code, conectar e confirmar que um lead real cai no `webhook-evo` (validação manual no painel).

---

## 🐢 Performance — Troca de cliente demora 24s

> Reportado em 13/06/2026. Afeta: aba **Leads Reais** e aba **Relatórios**. Disparado ao trocar o **dropdown de cliente** (ex: "Rei dos Colchões").

### Análise (causa raiz identificada)
Trocar o cliente chama `trocarClienteAdmin()` → `recarregarLeads()` → `GET /api/leads`. O endpoint (`api/leads.js`) tem dois problemas que somados causam os ~24s:

1. **Puxa até 5000 linhas com `SELECT *`** — o `limit` default é 5000 (`api/leads.js:18`). Sem o parâmetro, busca todas as colunas (incluindo venda, endereço, mensagens longas) de milhares de leads de uma vez.
2. **Ignora `start`/`end`** — o frontend envia o período (`start`/`end` em `recarregarLeads`, `js/leads.js`), mas a query do endpoint **não filtra por data**. A "otimização Hoje/Ontem" (commit `0f8ef8f`) existe só no front; o backend nunca aplicou o filtro. Resultado: transfere o histórico inteiro do cliente a cada troca.

O índice `idx_leads_cliente_data (cliente_id, created_at DESC)` já existe (`setup-db.js:68`) — **não é falta de índice**, é volume de dados transferido.

### Correção aplicada ✅
- `[x]` `api/leads.js` agora aplica `created_at >= $start AND created_at < $end` quando `start`/`end` vierem na query (WHERE montado dinamicamente).
- `[x]` `limit` default reduzido de 5000 → 500.
- `[x]` `metrics-temporal` confirmado: já filtrava por período (`metrics-temporal.js:29`).

---

## 🐞 CAPI do Painel (Venda / Qualificado)

> Reportado em 13/06/2026. Arquivo central: `api/leads-update.js` (rota PATCH disparada pelo botão do painel). Frontend: `js/leads.js` (`confirmarVenda` / `confirmarQualificacao`).

### Bug 1 — Botão "Enviar CAPI" não dispara de novo ✅
- `[x]` **Causa raiz:** descasamento de índice. A tabela renderiza com índice de `dadosFiltrados`, e `abrirModal(idx)` usava `dadosFiltrados[idx]` (correto), mas `qualificarLead(idx)`/`confirmarQualificacao` usavam `rawData[idx]`. Quando havia filtro/busca/recarga, `rawData` e `dadosFiltrados` divergiam → pegava o lead errado ou `undefined` (botão "não pega").
- `[x]` **Correção:** `qualificarLead` agora lê de `dadosFiltrados[idx]` e guarda o **id do lead** (estável), não o índice. `confirmarQualificacao` resolve o lead via `rawData.find(l => l.id === ...)`. (`js/leads.js`)

### Bug 2 — QualifiedLead rejeitado pela Meta ✅ (causa raiz confirmada pela Meta)
- `[x]` **Causa raiz real:** a Meta retornou `error_subcode 2804064` — *"Remove todos os argumentos inválidos... QualifiedLead com business_messaging: client_ip_address client_user_agent"*. Ou seja, esses campos são **proibidos** nesse canal/evento (o oposto da suspeita inicial). O page_id nunca foi o problema.
- `[x]` **Correção:** removidos `client_ip_address`/`client_user_agent` do `user_data` de QualifiedLead **e** Purchase (constante `CAPI_CLIENT_HINTS` excluída). `event_name` mantido (é válido).
- `[x]` O `resp.error` completo logado foi o que revelou o subcode — manter esse log ajuda em diagnósticos futuros.

### Bug 3 — Logs de CAPI não aparecem na aba "Logs do Sistema" ✅
- `[x]` **Causa confirmada:** a aba Logs lê de `webhook_logs`; o `api/leads-update.js` só fazia `console.log`/`console.warn`, nunca inseria nessa tabela.
- `[x]` **Correção:** novo helper `gravarLogCapi(pool, lead, tag, level, message, data)` insere em `webhook_logs` (tags `capi-purchase`/`capi-qualified`, level `info`/`error`) após cada envio — sucesso, rejeição, timeout e falta de pixel/token. Best-effort (não derruba o fluxo).
- `[x]` **Correção de coluna:** o INSERT usava `instance_name`, mas a coluna real de `webhook_logs` é `instance` (`setup-db.js:266`). Corrigido no helper **e** no `webhook-evo.js` (que tinha o mesmo erro, silenciado por um `catch` vazio — nunca gravava log de lead).

---

### 🎯 Dinâmica de feedback no painel ✅

O lead é **sempre salvo no banco** primeiro (status Vendido / Qualificado). O CAPI é um passo separado. O toast reflete o resultado real do envio à Meta, deixando claro que o registro local está salvo.

O backend retorna `capi: { sent, error }` no JSON. O front lê `result.capi.sent === false` para escolher a mensagem.

**Purchase (Venda) — `confirmarVenda()`**

| Resultado CAPI | Mensagem | Tipo |
|----------------|----------|------|
| `sent: true`   | "Venda registrada e CAPI enviado para a Meta!" | ✅ success |
| `sent: false`  | "Não foi enviado para a Meta, mas foi salvo no banco" | ⚠️ warning |

**QualifiedLead — `confirmarQualificacao()`**

| Resultado CAPI | Mensagem | Tipo |
|----------------|----------|------|
| `sent: true`   | "Lead Qualificado! Evento enviado." | ✅ success |
| `sent: false`  | "Não foi possível enviar para a Meta" | ❌ error |

**Notas de implementação**
- `[x]` `confirmarVenda`/`confirmarQualificacao` ramificam o toast por `result.capi.sent` conforme as tabelas. (`js/leads.js`)
- `[x]` Erros que impedem salvar no banco caem no `catch` com toast de erro genérico — distintos de "salvo mas CAPI falhou".
- `[x]` Tipo `warning` (amarelo) adicionado ao `toast()` (ícone `alert-triangle` em `index.html` + `.toast.warning` em `css/dashboard.css`).
- `[x]` Botão sempre destrava ao final (tratado pelo `finally`).
