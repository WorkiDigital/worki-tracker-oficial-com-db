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
