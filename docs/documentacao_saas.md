# Documentação de Funcionalidades: Adlytics SaaS (Multi-Tenant)

Esta documentação descreve o novo ecossistema do Adlytics após a migração para a arquitetura **PostgreSQL Multi-Tenant (SaaS)**. O sistema agora é capaz de operar múltiplas contas, isolando o tráfego de leads e as métricas do Facebook Ads de forma totalmente segura. Tudo é orquestrado através de um Painel Master Administrativo.

---

## 🏗️ 1. Arquitetura Multi-Tenant
O Adlytics deixou de ser um painel de *Single-User* para se tornar uma plataforma *Multi-User*.

- **Tabela Mestre `clientes`:** Cada agência, produto ou cliente que roda anúncios possui uma linha própria na tabela `clientes` do banco de dados. É aqui que moram as chaves ultra-secretas (`pixel_padrao`, `token_meta`).
- **Isolamento de Contas:** Nenhum usuário "Cliente" interage diretamente com as chaves privadas da API e Pixels. Eles não transitam no front-end, protegendo 100% o sigilo das integrações do N8N e Meta.
- **Relatórios Restritos:** Quando um lojista se loga, a API do backend filtra magicamente todos os leads no banco (`leads_tracking`) e também as abas do painel que contêm a anotação `cliente_id` compatível. O cliente **só enxerga o próprio terreno**.

---

## 👑 2. Sistema de Hierarquia (Permissões)
Acabamos de implementar o fluxo de poder **Master Admin** vs **User Convencional**.

> [!IMPORTANT]
> Apenas a primeira conta criada em um banco de dados recém zerado é coroada como Administrador Global (`is_admin = true`).

### O que o Master Admin consegue fazer?
- Tem acesso à aba militar secreta **"Gestão de Clientes"**.
- Consegue visualizar **absolutamente todos** os leads rodando pela ferramenta, prestando socorro imediato caso um cliente reporte problema.
- Adiciona novos Clientes/Bancos à plataforma via Dashboard. Ao criar um novo registro, ele digita o Pixel e o nome do cliente. Um vínculo é criado (gerando um novo *User* amarrado a aquele *Cliente*).

### O que o User (Cliente Final) consegue fazer?
- Vê e gerencia somente os leads que pertencem ao `cliente_id` da conta dele.
- Visualiza dados dos relatórios e campanhas isolados.
- Gera Relatórios de Compartilhamento (Share Dash) exclusos apenas com os anúncios autorizados de suas respectivas contabilidades meta.
- **A aba "Gestão de Clientes" fica sumida para essas pessoas.**

---

## 🎯 3. Integração N8N (Escalabilidade Limpa)
Antes da evolução, operar vários perfis criava um pesadelo de parâmetros URL sendo puxados por webhooks expostos.

**O Fluxo Novo do N8N:**
1. A única coisa que o script de automação no N8N precisa saber ao "conversar" com a API do sistema na hora em que o Lead chamar no WhatsApp é de **onde veio a conversa**. 
2. Para isso, o payload HTTP do N8N apenas entrega o `cliente_id = 5` (Exemplo).
3. Todo o estúpido maquinário engorda-lead, tracking, pixels, relatórios com metas e LTV é acionado silenciosamente pelo próprio backend Postgres do painel lendo a tabela nativa sem onerar a automação. 

---

## 🔗 4. Links Compartilháveis (Dashboard Público)
O Adlytics conta agora com visualizações dinâmicas públicas na rota `/share.html` para mandar métricas ao lojista.

Antes baseado em APIs externas que falhavam por token, hoje ele consulta um mapa de tokens `share_tokens` via Postgres. O modelo controla a exposição total em **três frentes**:
1. **Prazos:** Limita acessos através do campo `expires_at`.
2. **Camadas de Visualização:** Autoriza o Master a gerar chaves limitadas só para *Campanhas*, mascarando demográficos ou vice e versa.
3. **Isolamento de Erros:** APIs de consumo `share-ads`, `share-best` e `share-demo` foram isoladas para performar rapidamente (sem travar os requests caso o Meta limite a contagem de tempo real).

---

## 🚀 5. Startando a Vida (Setup Virgem)
Para quem acaba de clonar o Adlytics, a engrenagem roda com perfeição neste flow de início:
1. `npm install` no seu servidor e apontamento da variável de ambiente `DATABASE_URL` no `.env`.
2. Execução singular e inicial do `node reset-db.js` – (Zera as instâncias e constrói o Multi-Tenant puro na pedra).
3. Abertura pública da rota `login.html`.
4. Click na aba "Registrar".
5. Uma vez que o DB está sem vida (0 Usuários), esse primeiro login rouba a cena e salva na memória a glória do `is_admin`. E dali pra frente, o portal se fecha.

> [!NOTE]
> Todos esses funcionamentos foram re-implantados abolindo tecnologias lentas e de 3ºs. Hoje sua arquitetura de banco hospeda de **10** a **Infinitos Lojistas** sem bater cabeça com custo do Supabase.
