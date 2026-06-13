-- =============================================================================
-- diag-leads.sql — Diagnóstico dos dados de leads para CAPI (page_id, pixel, ctwa)
-- Foco: entender por que Purchase/QualifiedLead são rejeitados (page_id faltando).
--
-- Uso:  psql "$DATABASE_URL" -f docs/diag-leads.sql
--       (ou cole query por query no seu cliente SQL)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) VISÃO GERAL: quantos leads têm / não têm page_id, pixel, ctwa
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*)                                            AS total_leads,
  COUNT(*) FILTER (WHERE page_id    IS NOT NULL AND page_id    <> '') AS com_page_id,
  COUNT(*) FILTER (WHERE page_id    IS NULL OR  page_id    = '')      AS sem_page_id,
  COUNT(*) FILTER (WHERE pixel      IS NOT NULL AND pixel      <> '') AS com_pixel,
  COUNT(*) FILTER (WHERE ctw_aci_id IS NOT NULL AND ctw_aci_id <> '') AS com_ctwa
FROM leads_tracking;

-- -----------------------------------------------------------------------------
-- 2) MESMO RESUMO, POR CLIENTE — onde está o problema do page_id?
-- -----------------------------------------------------------------------------
SELECT
  c.id   AS cliente_id,
  c.nome AS cliente,
  c.pixel_padrao,
  COUNT(l.id)                                                          AS total_leads,
  COUNT(*) FILTER (WHERE l.page_id IS NULL OR l.page_id = '')          AS sem_page_id,
  COUNT(*) FILTER (WHERE l.page_id IS NOT NULL AND l.page_id <> '')    AS com_page_id
FROM clientes c
LEFT JOIN leads_tracking l ON l.cliente_id = c.id
GROUP BY c.id, c.nome, c.pixel_padrao
ORDER BY sem_page_id DESC;

-- -----------------------------------------------------------------------------
-- 3) ÚLTIMOS 20 LEADS — ver os campos crus que alimentam o CAPI
--    (event_source_url é de onde o page_id é extraído via regex facebook.com/<num>)
-- -----------------------------------------------------------------------------
SELECT
  id,
  cliente_id,
  nome,
  status,
  page_id,
  pixel,
  (ctw_aci_id IS NOT NULL) AS tem_ctwa,
  plataforma,
  LEFT(event_source_url, 80) AS source_url_inicio,
  created_at
FROM leads_tracking
ORDER BY id DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 4) LEADS SEM page_id — amostra das event_source_url para entender o formato
--    (assim vemos se a regex de extrairPageId() está perdendo URLs válidas)
-- -----------------------------------------------------------------------------
SELECT
  id,
  cliente_id,
  status,
  event_source_url,
  created_at
FROM leads_tracking
WHERE (page_id IS NULL OR page_id = '')
  AND event_source_url IS NOT NULL
ORDER BY id DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 5) DISTINCT dos page_id existentes por cliente — qual seria o "padrão" do cliente
--    (útil se formos usar um page_id de fallback por cliente)
-- -----------------------------------------------------------------------------
SELECT
  cliente_id,
  page_id,
  COUNT(*) AS qtd
FROM leads_tracking
WHERE page_id IS NOT NULL AND page_id <> ''
GROUP BY cliente_id, page_id
ORDER BY cliente_id, qtd DESC;

-- -----------------------------------------------------------------------------
-- 6) CONFIG DO CLIENTE — pixel e token (não expõe o token, só se existe)
-- -----------------------------------------------------------------------------
SELECT
  id,
  nome,
  pixel_padrao,
  (token_meta     IS NOT NULL) AS tem_token_plain,
  (token_meta_enc IS NOT NULL) AS tem_token_enc,
  account_id
FROM clientes
ORDER BY id;
