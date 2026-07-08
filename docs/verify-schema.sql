-- =============================================================================
-- verify-schema.sql — Verificação do schema esperado vs. real
-- Gerado a partir de setup-db.js. Compara o que DEVERIA existir com o que existe.
--
-- Como usar:
--   psql "$DATABASE_URL" -f docs/verify-schema.sql
--   (ou cole no seu cliente SQL conectado ao banco de produção)
--
-- Interpretação:
--   - "FALTANDO"  → a coluna/tabela esperada NÃO existe no banco (precisa rodar setup-db.js).
--   - "TIPO DIFERENTE" → a coluna existe mas com tipo diferente do esperado (revisar).
--   - Se as 3 últimas queries retornarem 0 linhas, o schema está 100% correto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) TABELAS ESPERADAS — lista as que estão FALTANDO
-- -----------------------------------------------------------------------------
WITH esperadas(tabela) AS (
  VALUES
    ('usuarios'), ('leads_tracking'), ('clientes'), ('share_tokens'),
    ('instancias_mapeamento'), ('zap_agendamentos'), ('zap_destinos'), ('configuracoes_sistema'),
    ('dashboard_settings'), ('metrics_cache'), ('webhook_logs'),
    ('relatorios_agendados')
)
SELECT e.tabela AS tabela_faltando, 'TABELA FALTANDO' AS status
FROM esperadas e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = e.tabela
WHERE t.table_name IS NULL
ORDER BY e.tabela;

-- -----------------------------------------------------------------------------
-- 2) COLUNAS ESPERADAS — lista as que estão FALTANDO
--    (data_type esperado é informativo; a checagem de existência é o principal)
-- -----------------------------------------------------------------------------
WITH esperadas(tabela, coluna, tipo_esperado) AS (
  VALUES
    -- usuarios
    ('usuarios','id','integer'),
    ('usuarios','email','character varying'),
    ('usuarios','senha_hash','character varying'),
    ('usuarios','criado_em','timestamp without time zone'),
    ('usuarios','cliente_id','integer'),
    ('usuarios','is_admin','boolean'),
    -- leads_tracking
    ('leads_tracking','id','integer'),
    ('leads_tracking','event_time','timestamp without time zone'),
    ('leads_tracking','nome','character varying'),
    ('leads_tracking','telefone','character varying'),
    ('leads_tracking','mensagem_recebida','text'),
    ('leads_tracking','instancia','character varying'),
    ('leads_tracking','plataforma','character varying'),
    ('leads_tracking','utm_campaign','character varying'),
    ('leads_tracking','utm_medium','character varying'),
    ('leads_tracking','utm_content','character varying'),
    ('leads_tracking','pixel','character varying'),
    ('leads_tracking','token','text'),
    ('leads_tracking','source_id','character varying'),
    ('leads_tracking','page_id','character varying'),
    ('leads_tracking','ctw_aci_id','text'),
    ('leads_tracking','event_source_url','text'),
    ('leads_tracking','anuncio_thumbnail_url','text'),
    ('leads_tracking','status','character varying'),
    ('leads_tracking','cidade','character varying'),
    ('leads_tracking','estado','character varying'),
    ('leads_tracking','pais','character varying'),
    ('leads_tracking','valor_venda','numeric'),
    ('leads_tracking','cliente_id','integer'),
    ('leads_tracking','produto','character varying'),
    ('leads_tracking','endereco','text'),
    ('leads_tracking','cor','character varying'),
    ('leads_tracking','forma_pagamento','character varying'),
    ('leads_tracking','cpf','character varying'),
    ('leads_tracking','email','character varying'),
    ('leads_tracking','created_at','timestamp without time zone'),
    ('leads_tracking','first_response_at','timestamp without time zone'),
    ('leads_tracking','qualified_at','timestamp without time zone'),
    ('leads_tracking','proposal_sent_at','timestamp without time zone'),
    ('leads_tracking','sale_closed_at','timestamp without time zone'),
    ('leads_tracking','last_interaction_at','timestamp without time zone'),
    ('leads_tracking','lead_score','integer'),
    -- clientes
    ('clientes','id','integer'),
    ('clientes','nome','character varying'),
    ('clientes','email_contato','character varying'),
    ('clientes','pixel_padrao','character varying'),
    ('clientes','token_meta','text'),
    ('clientes','token_meta_enc','bytea'),
    ('clientes','token_last4','character varying'),
    ('clientes','token_updated_at','timestamp without time zone'),
    ('clientes','criado_em','timestamp without time zone'),
    ('clientes','atualizado_em','timestamp without time zone'),
    ('clientes','permissoes','jsonb'),
    ('clientes','account_id','character varying'),
    ('clientes','template_venda','text'),
    ('clientes','template_qualificacao','text'),
    -- share_tokens
    ('share_tokens','token','character varying'),
    ('share_tokens','account_id','character varying'),
    ('share_tokens','account_name','character varying'),
    ('share_tokens','user_id','integer'),
    ('share_tokens','client_name','character varying'),
    ('share_tokens','visible_sections','jsonb'),
    ('share_tokens','visible_metrics','jsonb'),
    ('share_tokens','visible_columns','jsonb'),
    ('share_tokens','status_filter','character varying'),
    ('share_tokens','expires_at','timestamp without time zone'),
    ('share_tokens','created_at','timestamp without time zone'),
    -- instancias_mapeamento
    ('instancias_mapeamento','id','integer'),
    ('instancias_mapeamento','instance_name','character varying'),
    ('instancias_mapeamento','cliente_id','integer'),
    ('instancias_mapeamento','criado_em','timestamp without time zone'),
    -- zap_agendamentos
    ('zap_agendamentos','id','integer'),
    ('zap_agendamentos','cliente_id','integer'),
    ('zap_agendamentos','instance_name','character varying'),
    ('zap_agendamentos','destino_tipo','character varying'),
    ('zap_agendamentos','destino_jid','character varying'),
    ('zap_agendamentos','destino_nome','character varying'),
    ('zap_agendamentos','template','text'),
    ('zap_agendamentos','frequencia','character varying'),
    ('zap_agendamentos','horario','time without time zone'),
    ('zap_agendamentos','status','character varying'),
    ('zap_agendamentos','criado_em','timestamp without time zone'),
    ('zap_agendamentos','periodo','character varying'),
    ('zap_agendamentos','account_id','character varying'),
    ('zap_agendamentos','ultimo_envio_chave','character varying'),
    ('zap_agendamentos','ultimo_envio_em','timestamp with time zone'),
    ('zap_agendamentos','destino_id','integer'),
    -- zap_destinos (nível 1: canal fixo — conta + destino WhatsApp; zap_agendamentos
    -- é o "relatório" filho, N por destino, vinculado via destino_id)
    ('zap_destinos','id','integer'),
    ('zap_destinos','cliente_id','integer'),
    ('zap_destinos','nome','character varying'),
    ('zap_destinos','account_id','character varying'),
    ('zap_destinos','instance_name','character varying'),
    ('zap_destinos','destino_tipo','character varying'),
    ('zap_destinos','destino_jid','character varying'),
    ('zap_destinos','destino_nome','character varying'),
    ('zap_destinos','criado_em','timestamp without time zone'),
    -- configuracoes_sistema
    ('configuracoes_sistema','id','integer'),
    ('configuracoes_sistema','chave','character varying'),
    ('configuracoes_sistema','valor','text'),
    ('configuracoes_sistema','criado_em','timestamp without time zone'),
    ('configuracoes_sistema','atualizado_em','timestamp without time zone'),
    -- dashboard_settings
    ('dashboard_settings','id','uuid'),
    ('dashboard_settings','user_id','integer'),
    ('dashboard_settings','ad_account_id','character varying'),
    ('dashboard_settings','metrics_cfg','jsonb'),
    ('dashboard_settings','demo_cfg','jsonb'),
    ('dashboard_settings','created_at','timestamp without time zone'),
    ('dashboard_settings','updated_at','timestamp without time zone'),
    -- metrics_cache
    ('metrics_cache','id','integer'),
    ('metrics_cache','cliente_id','integer'),
    ('metrics_cache','account_id','character varying'),
    ('metrics_cache','data_referencia','date'),
    ('metrics_cache','metrics','jsonb'),
    ('metrics_cache','atualizado_em','timestamp without time zone'),
    -- webhook_logs  (atenção: coluna é "instance", NÃO "instance_name")
    ('webhook_logs','id','integer'),
    ('webhook_logs','created_at','timestamp without time zone'),
    ('webhook_logs','instance','character varying'),
    ('webhook_logs','cliente_id','integer'),
    ('webhook_logs','level','character varying'),
    ('webhook_logs','tag','character varying'),
    ('webhook_logs','message','text'),
    ('webhook_logs','data','jsonb'),
    -- relatorios_agendados
    ('relatorios_agendados','id','uuid'),
    ('relatorios_agendados','cliente_id','integer'),
    ('relatorios_agendados','instance_name','character varying'),
    ('relatorios_agendados','target_jid','character varying'),
    ('relatorios_agendados','is_group','boolean'),
    ('relatorios_agendados','nome_destino','character varying'),
    ('relatorios_agendados','metricas','jsonb'),
    ('relatorios_agendados','frequencia','character varying'),
    ('relatorios_agendados','horario_envio','character varying'),
    ('relatorios_agendados','mensagem_template','text'),
    ('relatorios_agendados','status','boolean'),
    ('relatorios_agendados','created_at','timestamp without time zone'),
    ('relatorios_agendados','updated_at','timestamp without time zone')
)
SELECT
  e.tabela,
  e.coluna,
  e.tipo_esperado,
  'COLUNA FALTANDO' AS status
FROM esperadas e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name   = e.tabela
 AND c.column_name  = e.coluna
WHERE c.column_name IS NULL
ORDER BY e.tabela, e.coluna;

-- -----------------------------------------------------------------------------
-- 3) COLUNAS COM TIPO DIVERGENTE — existe, mas o data_type não bate
--    (mesma lista da query 2; só mostra as que existem com tipo diferente)
-- -----------------------------------------------------------------------------
WITH esperadas(tabela, coluna, tipo_esperado) AS (
  VALUES
    ('leads_tracking','ctw_aci_id','text'),
    ('leads_tracking','valor_venda','numeric'),
    ('leads_tracking','lead_score','integer'),
    ('clientes','token_meta_enc','bytea'),
    ('clientes','permissoes','jsonb'),
    ('webhook_logs','instance','character varying'),
    ('webhook_logs','data','jsonb'),
    ('zap_agendamentos','ultimo_envio_em','timestamp with time zone'),
    ('dashboard_settings','id','uuid'),
    ('relatorios_agendados','id','uuid')
)
SELECT
  e.tabela,
  e.coluna,
  e.tipo_esperado,
  c.data_type AS tipo_real,
  'TIPO DIFERENTE' AS status
FROM esperadas e
JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name   = e.tabela
 AND c.column_name  = e.coluna
WHERE c.data_type <> e.tipo_esperado
ORDER BY e.tabela, e.coluna;
