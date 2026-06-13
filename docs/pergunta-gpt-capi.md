# Pergunta para análise — CAPI Business Messaging (WhatsApp)

Preciso que você consulte a **documentação oficial da Meta** (Conversions API for Business Messaging) e responda com base nela, citando as fontes.

## Contexto

Estou enviando eventos para a **Conversions API da Meta** no canal de **mensagens (Click-to-WhatsApp / CTWA)**, com:

- `action_source: "business_messaging"`
- `messaging_channel: "whatsapp"`

Eventos que envio: **`Purchase`**, **`QualifiedLead`** e **`LeadSubmitted`**.

## O problema

O evento **`LeadSubmitted`** é **ACEITO** pela Meta enviando um `user_data` enxuto:

```json
"user_data": {
  "ctwa_clid": "<click id do anúncio CTWA>",
  "ph": ["<sha256 do telefone>"],
  "page_id": "<id da página do Facebook>"
}
```

Mas os eventos **`Purchase`** e **`QualifiedLead`** estão sendo **REJEITADOS** quando incluo campos extras de advanced matching no `user_data`:

```json
"user_data": {
  "ctwa_clid": "<click id>",
  "ph": "<sha256 telefone>",
  "fn": "<sha256 primeiro nome>",
  "ln": "<sha256 sobrenome>",
  "em": "<sha256 email>",
  "external_id": "<sha256 cpf>",
  "ct": "<sha256 cidade>",
  "st": "<sha256 estado>",
  "country": "<sha256 'br'>",
  "page_id": "<id da página>"
}
```

### Erros retornados pela Meta

1. Primeiro erro (quando eu incluía `client_ip_address` e `client_user_agent`):
   - `error_subcode: 2804064`
   - *"Remove todos os argumentos inválidos dos teus eventos QualifiedLead com a fonte da ação business_messaging: client_ip_address client_user_agent."*

2. Após remover esses dois, o erro mudou para:
   - `error_subcode: 2804116`
   - *"O teu evento Purchase com a fonte da ação business_messaging do canal whatsapp tem o parâmetro page_id ou whatsapp_business_account_id em falta. Fornece um valor válido para o parâmetro page_id ou whatsapp_business_account_id nos dados de utilizador."*
   - **Observação:** o `page_id` ESTÁ sendo enviado e é válido (o mesmo `page_id` funciona no `LeadSubmitted`). Suspeito que algum campo extra invalida o `user_data` inteiro, fazendo a Meta reportar o `page_id` como ausente.

## O que preciso que você responda (com base na doc oficial)

1. No canal **`business_messaging` / `whatsapp`**, qual é a **lista completa de campos permitidos** dentro de `user_data` para os eventos `Purchase` e `QualifiedLead`?

2. Especificamente, **é permitido enviar** estes campos de advanced matching nesse canal? Responda **um por um** (permitido / proibido / opcional):
   - `em` (email)
   - `ph` (telefone)
   - `fn` (primeiro nome)
   - `ln` (sobrenome)
   - `external_id` (CPF)
   - `ct` (cidade)
   - `st` (estado)
   - `country` (país)
   - `ctwa_clid`
   - `page_id`
   - `whatsapp_business_account_id`

3. Há **campos explicitamente proibidos** no canal `business_messaging` (como `client_ip_address` e `client_user_agent` já se mostraram proibidos)? Liste todos os que a doc menciona como inválidos para esse canal.

4. O `ph` deve ser enviado como **array** (`["hash"]`) ou **string** (`"hash"`) nesse canal? Há diferença de aceitação?

5. O `error_subcode 2804116` ("page_id em falta") pode ser disparado por um **campo extra inválido** no `user_data` (e não pela ausência real do page_id)? Ou seja: enviar um campo não suportado faz a Meta invalidar o objeto inteiro?

6. Se quero **manter** email, telefone, nome, CPF e cidade no Purchase (para melhor atribuição), **qual é a forma correta e suportada** de enviá-los nesse canal sem ser rejeitado?

## Formato da resposta

- Cite os **links da documentação oficial da Meta** usados.
- Seja específico sobre **business_messaging / whatsapp** (não a CAPI web/padrão, que tem regras diferentes).
- Se a doc não cobrir algum ponto, diga explicitamente "a doc não especifica".
