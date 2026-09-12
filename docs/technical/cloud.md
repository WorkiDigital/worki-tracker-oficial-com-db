# Progresso do Projeto - WhatsApp Tracking (White-label)

Este arquivo registra as principais evoluções e marcos do projeto implementados recentemente.

## 🚀 Marcos Alcançados

### 1. Sistema de White-label Integral
- **Configurações Dinâmicas:** Implementada a tabela `configuracoes_sistema` para armazenar o Nome do Projeto e o Logotipo.
- **API de Configuração:** Criados os endpoints `/api/config` para leitura e salvamento das preferências de branding.

### 2. Personalização de Identidade Visual (Branding)
- **Logotipos Dinâmicos:** Todas as telas carregam agora o logo definido pelo administrador (suporta SVG inline e URL de imagem).
- **Ajustes de UI/UX (Consistência Visual):**
    - **Login:** Container do logo aumentado para `64px` com ícone de `44px`. Texto da marca aumentado para `22px`.
    - **Dashboard Principal:** Sidebar agora carrega dinamicamente o nome e logo do projeto (Tamanho do logo: `40px`, Texto: `18px`).
    - **Painel Compartilhado (`share.html`):** Logotipo aumentado para `48px` para melhor visualização do cliente final.
- **Variáveis Globais:** Uso de `window.BRAND_NAME` em scripts para garantir consistência no nome da marca em diálogos de cópia e títulos de página.

### 3. Infraestrutura e Banco de Dados
- **Suporte a Novas Colunas:** Script `setup-db.js` atualizado para garantir a criação automática da tabela de configurações.
- **Sincronização:** Logotipo e nome sincronizados entre Login, Painel Admin e Painel do Cliente.

### 4. Deploy e Produção
- **GitHub Sync:** Todas as alterações integradas e enviadas para o repositório `WorkiDigital/worki-tracker-oficial-com-db`.
- **EasyPanel:** Automação de deploy configurada via GitHub (Commit: `14e42bc`).

---
*Última atualização: 18 de Abril de 2026*
