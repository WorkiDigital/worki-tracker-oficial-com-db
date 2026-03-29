# PLANO DE INTEGRAÇÃO N8N (SaaS)

Sua arquitetura antiga dependia de acessar o **Supabase** e o **Facebook Graph API** diretamente pelo N8N.
Com a evolução para o Multi-Tenant PostgreSQL, seu N8N precisa de uma limpa geral.

### O PROBLEMA ATUAL DO SEU N8N
1. Você usa o Node do Supabase (que perdeu utilidade real de nuvem no nosso projeto).
2. Você usa o Node da API do Facebook enviando CAPI de Purchase.
3. Você gera Hashes e Tokens confusos.

### O NOVO FLUXO N8N (A SER IMPLEMENTADO NA VOLTA)
Nós vamos desenvolver um túnel oficial: um Webhook no prório Adlytics (ex: `/api/webhook-n8n`).

**Deletaremos tudo no N8N e ficará apenas:**
1. Nó de Recebimento do WhatsApp (Trigger).
2. Nó de Limpeza (Set/Normalizar).
3. **HTTP Request Node (Enviando o Lead PRO Adlytics):**
   - **Método**: POST
   - **URL**: `https://seu-painel.com/api/webhook-n8n`
   - **Corpo Mágico (JSON)**:
     ```json
     {
        "cliente_id": 5,
        "telefone": "{{ $json.telefone }}",
        "nome": "{{ $json.nome }}",
        "evento": "lead" // ou "purchase"
     }
     ```

### POR QUE ISSO É MELHOR?
Todo o cálculo de **CAPI do Facebook**, leitura de **Tokens Meta** e validação no **Banco de Dados PostgreSQL** acontece em microssegundos direto no seu servidor. O N8N não processa mais nada e você poupa CPU.

*Quando você retornar, iremos criar o código do `webhook-n8n.js` e rodar a primeira automação para valer!*
