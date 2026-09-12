# Plano: gzip + Cache-Control nos arquivos estáticos (sem quebrar nada)

## Contexto / Problema

Testado em produção (`adlyticspro.workidigital.tech`):
- Nenhum arquivo estático tem `Cache-Control`, `ETag` nem `Content-Encoding: gzip`.
- `index.html` = **340 KB** baixados crus em TODA visita/F5 (mesmo pedindo `Accept-Encoding: gzip`).
- `leads.js` 72 KB, `captacao.js` 48 KB — idem, sem cache nem compressão.
- Não há CDN/proxy comprimindo na frente (nenhum header `Server:`/`Via:`/`CF-*`); o container Node responde direto atrás do proxy do EasyPanel.

Ganho esperado: `index.html` 340 KB → ~65-85 KB (gzip ~75% menor); a partir do 2º F5, JS/CSS versionados vêm do cache do navegador (0 bytes de rede).

## Restrição absoluta: NÃO quebrar nada

Três armadilhas identificadas no código atual que o plano precisa respeitar:

1. **`wapptrack.js` está em sites de TERCEIROS, sem `?v=`.** Clientes colam `<script src=".../js/wapptrack.js">` fixo. Cache longo aqui = cliente preso a versão antiga por dias quando atualizarmos o script. → **Cache curto e revalidável neste arquivo.**

2. **Versionamento inconsistente no `index.html`:**
   - COM `?v=`: `dashboard.css`, `leads.js`, `admin.js`, `captacao.js` (podem ter cache longo — trocar `?v=` força reload).
   - SEM `?v=`: `utils.js`, `reports-auto.js`, `splash.css` (cache longo = risco de versão presa após deploy). → **Cache curto nestes até serem versionados.**

3. **`index.html` / `login.html` / `share.html` (o "shell" do SPA)** precisam sempre refletir o deploy mais novo. → **`no-cache` (revalida sempre), NUNCA `max-age` longo.**

## Abordagem

Alterar APENAS o bloco de arquivos estáticos do `server.js` (linhas ~225-250). Nenhuma mudança em rotas `/api/*`, redirect, webhook ou lógica de negócio.

### Parte 1 — gzip condicional (zlib nativo, sem dependência nova)

- Só comprime tipos texto: `.html`, `.js`, `.css`, `.json`, `.svg`.
- Só comprime se o cliente enviar `Accept-Encoding: gzip` (verificar `req.headers['accept-encoding']`).
- Nunca comprimir binários já comprimidos (`.png`, `.jpg`, `.webp`, `.ico`).
- Emitir `Content-Encoding: gzip` + `Vary: Accept-Encoding` quando comprimir.
- Usar streaming: `fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res)` — mantém o padrão de streaming atual, sem carregar arquivo inteiro em memória.
- Fallback: se o cliente não aceitar gzip, servir cru exatamente como hoje (`createReadStream(...).pipe(res)`).
- **Não definir `Content-Length` quando comprimir** (o tamanho muda); com streaming + chunked isso já é natural.

### Parte 2 — Cache-Control por categoria de arquivo

Definir o header conforme o tipo, dentro do mesmo bloco:

| Categoria | Regra | `Cache-Control` |
|---|---|---|
| Shell do SPA (`index.html`, `login.html`, `share.html`) | sempre revalida | `no-cache` |
| `wapptrack.js` (terceiros, sem `?v=`) | revalida rápido | `public, max-age=300, must-revalidate` (5 min) |
| Assets versionados (`/js/`, `/css/`) — quando a REQUISIÇÃO tem `?v=` na query | imutável | `public, max-age=31536000, immutable` |
| Assets `/js/`, `/css/` SEM `?v=` na requisição | seguro | `public, max-age=300` (5 min) |
| Imagens (`/img/`, `.png/.jpg/.webp/.ico`) | cache médio | `public, max-age=86400` (1 dia) |

Regra decisiva de versionamento: olhar `url.searchParams.has('v')` da REQUISIÇÃO (não o nome do arquivo). Assim `leads.js?v=20260622-1` recebe cache longo automaticamente, e trocar o `?v=` no `index.html` invalida (URL nova = entrada de cache nova). Arquivos sem `?v=` caem no fallback curto de 5 min — seguro mesmo sem versionar.

`wapptrack.js` é exceção explícita (checar `path.basename(filePath) === 'wapptrack.js'`) porque mesmo que um dia leve `?v=`, os sites de terceiros já instalados não têm — 5 min de cache é o teto seguro.

## Arquivo único a modificar

- `server.js` — bloco de estáticos (linhas ~225-250). Adicionar `import zlib from 'zlib'` no topo (junto dos outros imports nativos). Preservar todos os headers de segurança já existentes (`X-Content-Type-Options`, `X-Frame-Options`, etc.).

Nenhum outro arquivo muda. Nenhuma dependência nova (zlib é nativo do Node).

## Verificação (antes → depois, com os mesmos comandos)

Baseline JÁ capturado (ANTES):
- `index.html`: 340.538 bytes, sem cache/gzip.
- `leads.js`: 72.278 bytes, sem cache/gzip.

Após deploy, rodar:

1. **gzip ativo:**
   `curl -s -H "Accept-Encoding: gzip" -o /dev/null -w "%{size_download} bytes\n" .../` → deve cair de 340 KB para ~65-85 KB.

2. **Headers corretos por tipo:**
   - `curl -sI .../` → `Cache-Control: no-cache`.
   - `curl -sI .../js/leads.js?v=20260622-1` → `max-age=31536000, immutable`.
   - `curl -sI .../js/wapptrack.js` → `max-age=300`.
   - `curl -sI .../js/utils.js` (sem ?v=) → `max-age=300`.

3. **Sem gzip quando não pedido (fallback intacto):**
   `curl -s -H "Accept-Encoding:" -o /dev/null -w "%{size_download}\n" .../js/wapptrack.js` → serve cru, 200.

4. **Nada regrediu:**
   - `/health` → 200.
   - `/js/wapptrack.js` → 200 e conteúdo idêntico (`curl ... | grep aplicarTextoBotao`).
   - Endpoints POST `/api/site-pageview` e `/api/site-whatsapp-click` → 200 (não passam pelo bloco de estáticos, mas confirmar que o deploy não derrubou o processo).
   - Login no painel + carregar leads → funcional.
   - Imagens do painel carregam.

5. **Cache real no navegador:** F12 → Network → 2º F5 → `leads.js?v=...` aparece como "(from disk cache)"; `index.html` sempre revalida (200 ou 304).

6. **Deploy novo não fica preso:** após um deploy futuro, um F5 normal (sem Ctrl+Shift+R) deve trazer o `index.html` novo (graças ao `no-cache`), e o `wapptrack.js` no máximo 5 min depois.

## Rollback

Mudança isolada num único bloco. Se algo sair errado, `git revert` do commit restaura o comportamento atual (servir cru sem cache) — que é exatamente o estado de hoje, então rollback é 100% seguro.
