import { getPool } from './_db.js';

let schemaPromise = null;

async function createTrackingSchema() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Serializa a migração entre processos/containers que compartilham o banco.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('adlytics_tracking_schema_v1'))");

    await client.query(`
      ALTER TABLE public.leads_tracking
      ADD COLUMN IF NOT EXISTS lead_origin VARCHAR(20),
      ADD COLUMN IF NOT EXISTS utm_source VARCHAR(255),
      ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(255),
      ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(255),
      ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255);

      CREATE TABLE IF NOT EXISTS public.lead_capture_settings (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        instance_name VARCHAR(100) NOT NULL,
        capture_mode VARCHAR(20) DEFAULT 'ctwa_only',
        keywords TEXT[] DEFAULT '{}',
        keyword_match VARCHAR(10) DEFAULT 'partial',
        deduplication_hours INTEGER DEFAULT 24,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (cliente_id, instance_name)
      );

      CREATE TABLE IF NOT EXISTS public.tracking_campaigns (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(120) UNIQUE NOT NULL,
        origin_type VARCHAR(20) DEFAULT 'bio',
        rotation_mode VARCHAR(20) DEFAULT 'single',
        default_message TEXT,
        utm_source VARCHAR(255),
        utm_medium VARCHAR(255),
        utm_campaign VARCHAR(255),
        utm_content VARCHAR(255),
        enabled BOOLEAN DEFAULT true,
        archived_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS public.tracking_destinations (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES public.tracking_campaigns(id) ON DELETE CASCADE,
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        name VARCHAR(120),
        whatsapp_number VARCHAR(30) NOT NULL,
        instance_name VARCHAR(100),
        weight INTEGER DEFAULT 1,
        position INTEGER DEFAULT 0,
        enabled BOOLEAN DEFAULT true,
        total_redirects INTEGER DEFAULT 0,
        last_selected_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS public.tracking_clicks (
        id SERIAL PRIMARY KEY,
        tracking_id VARCHAR(40) UNIQUE NOT NULL,
        campaign_id INTEGER REFERENCES public.tracking_campaigns(id) ON DELETE CASCADE,
        destination_id INTEGER REFERENCES public.tracking_destinations(id) ON DELETE SET NULL,
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'clicked',
        utm_source VARCHAR(255),
        utm_medium VARCHAR(255),
        utm_campaign VARCHAR(255),
        utm_content VARCHAR(255),
        referrer TEXT,
        ip_address VARCHAR(64),
        user_agent TEXT,
        event_source_url TEXT,
        geo_city VARCHAR(120),
        geo_region VARCHAR(120),
        geo_region_code VARCHAR(20),
        geo_country VARCHAR(120),
        geo_country_code VARCHAR(10),
        placement VARCHAR(120),
        ad_id VARCHAR(64),
        adset_id VARCHAR(64),
        meta_campaign_id VARCHAR(64),
        gclid VARCHAR(512),
        google_ads_keyword VARCHAR(255),
        whatsapp_number VARCHAR(30),
        instance_name VARCHAR(100),
        clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        converted_at TIMESTAMP,
        lead_id INTEGER REFERENCES public.leads_tracking(id) ON DELETE SET NULL
      );

      ALTER TABLE public.leads_tracking
      ADD COLUMN IF NOT EXISTS tracking_click_id INTEGER REFERENCES public.tracking_clicks(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS tracking_campaign_id INTEGER REFERENCES public.tracking_campaigns(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS tracking_method VARCHAR(40);

      -- Bancos antigos criaram tracking_method como VARCHAR(20); valores como
      -- 'recent_click_correlation' (24 chars) estouravam o limite e o UPDATE do
      -- lead falhava silenciosamente (lead órfão: campaign_link sem click_id).
      -- Amplia para 40 de forma idempotente.
      ALTER TABLE public.leads_tracking
        ALTER COLUMN tracking_method TYPE VARCHAR(40);

      ALTER TABLE public.tracking_clicks
      ADD COLUMN IF NOT EXISTS instance_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255),
      ADD COLUMN IF NOT EXISTS event_source_url TEXT,
      ADD COLUMN IF NOT EXISTS geo_city VARCHAR(120),
      ADD COLUMN IF NOT EXISTS geo_region VARCHAR(120),
      ADD COLUMN IF NOT EXISTS geo_region_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS geo_country VARCHAR(120),
      ADD COLUMN IF NOT EXISTS geo_country_code VARCHAR(10),
      ADD COLUMN IF NOT EXISTS fbclid VARCHAR(512),
      ADD COLUMN IF NOT EXISTS fbc VARCHAR(512),
      ADD COLUMN IF NOT EXISTS fbp VARCHAR(255),
      ADD COLUMN IF NOT EXISTS pageview_event_id VARCHAR(60),
      ADD COLUMN IF NOT EXISTS capi_web_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS placement VARCHAR(120),
      ADD COLUMN IF NOT EXISTS ad_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS adset_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS meta_campaign_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS gclid VARCHAR(512),
      ADD COLUMN IF NOT EXISTS google_ads_keyword VARCHAR(255);

      -- gbraid/wbraid: identificadores de clique do Google Ads para fluxos sem
      -- cookie de terceiros (iOS/Safari, campanhas Performance Max). Paridade
      -- com gclid, que já existe acima.
      ALTER TABLE public.tracking_clicks
      ADD COLUMN IF NOT EXISTS gbraid VARCHAR(512),
      ADD COLUMN IF NOT EXISTS wbraid VARCHAR(512);

      ALTER TABLE public.tracking_campaigns
      ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255),
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS conversion_event VARCHAR(40) DEFAULT 'lead',
      ADD COLUMN IF NOT EXISTS conversion_auto BOOLEAN DEFAULT false;

      ALTER TABLE public.clientes
      ADD COLUMN IF NOT EXISTS capi_pixel_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS capi_token_enc BYTEA,
      ADD COLUMN IF NOT EXISTS capi_token_last4 VARCHAR(6),
      ADD COLUMN IF NOT EXISTS capi_token_updated_at TIMESTAMP;

      ALTER TABLE public.usuarios
      ADD COLUMN IF NOT EXISTS onboarding_completo BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS onboarding_perfil VARCHAR(20);

      UPDATE public.usuarios SET onboarding_completo = TRUE WHERE criado_em < '2026-07-14 00:00:00' AND onboarding_completo IS FALSE;


      CREATE INDEX IF NOT EXISTS idx_capture_cliente_instance
        ON public.lead_capture_settings(cliente_id, instance_name);
      CREATE INDEX IF NOT EXISTS idx_tracking_campaigns_cliente
        ON public.tracking_campaigns(cliente_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_dest_campaign
        ON public.tracking_destinations(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_clicks_campaign
        ON public.tracking_clicks(campaign_id, clicked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tracking_clicks_status
        ON public.tracking_clicks(cliente_id, status, clicked_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tracking_click_unique
        ON public.leads_tracking(tracking_click_id)
        WHERE tracking_click_id IS NOT NULL;

      -- ── Jornada configurável de conversões Meta (Fase 1) ──
      -- Etapas configuráveis POR CLIENTE (uma jornada vale p/ todas as instâncias).
      CREATE TABLE IF NOT EXISTS public.journey_stages (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        tracking_campaign_id INTEGER REFERENCES public.tracking_campaigns(id) ON DELETE CASCADE,
        name VARCHAR(120) NOT NULL,
        event_concept VARCHAR(20) NOT NULL,   -- lead|qualified|appointment|checkout|purchase
        trigger_type VARCHAR(20) DEFAULT 'keyword', -- first_message|keyword
        keywords TEXT[] DEFAULT '{}',
        keyword_match VARCHAR(10) DEFAULT 'partial', -- exact|partial
        value_regex TEXT,                     -- regex com grupo nomeado (?<value>...)
        currency VARCHAR(8) DEFAULT 'BRL',
        position INTEGER DEFAULT 0,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE public.journey_stages
      ADD COLUMN IF NOT EXISTS tracking_campaign_id INTEGER REFERENCES public.tracking_campaigns(id) ON DELETE CASCADE;

      -- Histórico de jornada por lead: 1 linha por (lead, etapa) — UNIQUE impede duplicar.
      CREATE TABLE IF NOT EXISTS public.lead_journey_history (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER REFERENCES public.leads_tracking(id) ON DELETE CASCADE,
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        stage_id INTEGER REFERENCES public.journey_stages(id) ON DELETE SET NULL,
        event_concept VARCHAR(20) NOT NULL,
        event_name VARCHAR(40),               -- nome real enviado à Meta (LeadSubmitted, Purchase…)
        trigger_message TEXT,
        value NUMERIC(14,2),
        currency VARCHAR(8) DEFAULT 'BRL',
        channel VARCHAR(20),                  -- business_messaging|website
        event_id VARCHAR(80),                 -- determinístico p/ dedup da Meta
        meta_status VARCHAR(12) DEFAULT 'pending', -- pending|sent|error|skipped
        meta_response TEXT,
        fbtrace_id VARCHAR(80),
        attempts INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_attempt_at TIMESTAMP,
        UNIQUE (lead_id, stage_id)
      );

      ALTER TABLE public.leads_tracking
      ADD COLUMN IF NOT EXISTS current_stage_id INTEGER REFERENCES public.journey_stages(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP;

      CREATE INDEX IF NOT EXISTS idx_journey_stages_cliente
        ON public.journey_stages(cliente_id, position);
      CREATE INDEX IF NOT EXISTS idx_journey_stages_campaign
        ON public.journey_stages(tracking_campaign_id, position)
        WHERE tracking_campaign_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_lead_journey_hist_lead
        ON public.lead_journey_history(lead_id);
      CREATE INDEX IF NOT EXISTS idx_lead_journey_hist_status
        ON public.lead_journey_history(cliente_id, meta_status);

      -- ── Script para site (wapptrack.js) — PageViews de páginas externas ──
      -- Separado de tracking_clicks (que representa clique real no botão WhatsApp),
      -- para não inflar a métrica de Cliques com simples visualizações de página.
      CREATE TABLE IF NOT EXISTS public.tracking_pageviews (
        id SERIAL PRIMARY KEY,
        visitor_id VARCHAR(60) NOT NULL,
        campaign_id INTEGER REFERENCES public.tracking_campaigns(id) ON DELETE CASCADE,
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        page_url TEXT,
        page_title VARCHAR(500),
        referrer TEXT,
        utm_source VARCHAR(255),
        utm_medium VARCHAR(255),
        utm_campaign VARCHAR(255),
        utm_content VARCHAR(255),
        fbclid VARCHAR(512),
        fbc VARCHAR(512),
        fbp VARCHAR(255),
        ip_address VARCHAR(64),
        user_agent TEXT,
        pageview_event_id VARCHAR(60),
        capi_web_status VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_tracking_pageviews_campaign
        ON public.tracking_pageviews(campaign_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tracking_pageviews_visitor
        ON public.tracking_pageviews(visitor_id);

      -- gclid/gbraid/wbraid do PageView: hoje o site-pageview.js recebia o gclid
      -- só para decidir se devolvia as credenciais Google Ads na resposta, mas
      -- descartava o valor em seguida. Persistindo aqui, dá pra rastrear o clique
      -- de anúncio Google desde a primeira visita, não só no momento do clique
      -- no botão do WhatsApp.
      ALTER TABLE public.tracking_pageviews
      ADD COLUMN IF NOT EXISTS gclid VARCHAR(512),
      ADD COLUMN IF NOT EXISTS gbraid VARCHAR(512),
      ADD COLUMN IF NOT EXISTS wbraid VARCHAR(512);

      CREATE INDEX IF NOT EXISTS idx_tracking_pageviews_gclid
        ON public.tracking_pageviews(gclid) WHERE gclid IS NOT NULL;

      -- Domínios autorizados a usar o script por campanha (opcional; vazio = qualquer domínio).
      ALTER TABLE public.tracking_campaigns
      ADD COLUMN IF NOT EXISTS allowed_domains TEXT[] DEFAULT '{}';

      -- Texto do botão do WhatsApp no script de site (opcional). Se preenchido, o
      -- wapptrack.js escreve esse texto no botão automaticamente; NULL preserva o
      -- texto que o cliente já escreveu manualmente no HTML/JSX do site.
      ALTER TABLE public.tracking_campaigns
      ADD COLUMN IF NOT EXISTS button_text VARCHAR(80);

      -- Textos e cor de fundo personalizaveis da pagina intermediaria de
      -- redirecionamento (/r/<slug>). NULL = usa os padroes do redirect.js.
      ALTER TABLE public.tracking_campaigns
      ADD COLUMN IF NOT EXISTS redirect_title VARCHAR(120),
      ADD COLUMN IF NOT EXISTS redirect_subtitle VARCHAR(200),
      ADD COLUMN IF NOT EXISTS redirect_bg_color VARCHAR(20);

      -- Vincula o clique nascido do script de site ao visitor_id do PageView,
      -- permitindo correlacionar PageView → clique → lead na jornada.
      ALTER TABLE public.tracking_clicks
      ADD COLUMN IF NOT EXISTS visitor_id VARCHAR(60),
      ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'redirect';
    `);

    // Integridade da atribuição: um clique que já virou lead (status='converted')
    // NÃO pode ser deletado — senão o ON DELETE SET NULL deixaria o lead órfão
    // (campaign_link sem vínculo). O trigger bloqueia o DELETE no nível do banco,
    // protegendo a atribuição independente de quem rode o DELETE (app, script, SQL manual).
    await client.query(`
      CREATE OR REPLACE FUNCTION bloquear_delete_clique_convertido()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.status = 'converted' THEN
          RAISE EXCEPTION 'Clique % já foi convertido em lead e não pode ser apagado (preserva a atribuição).', OLD.tracking_id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query('DROP TRIGGER IF EXISTS trg_bloquear_delete_clique_convertido ON public.tracking_clicks');
    await client.query(`
      CREATE TRIGGER trg_bloquear_delete_clique_convertido
      BEFORE DELETE ON public.tracking_clicks
      FOR EACH ROW EXECUTE FUNCTION bloquear_delete_clique_convertido();
    `);

    // Link publico de curta duracao para compartilhar um QR Code de conexao
    // WhatsApp ja gerado com quem nao tem acesso ao painel (ex: dono do
    // celular). Vida curta (minutos) -> schema lazy aqui, nao em setup-db.js.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.wa_connect_links (
        token VARCHAR(64) PRIMARY KEY,
        instance_name VARCHAR(255) NOT NULL,
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        qr_base64 TEXT NOT NULL,
        created_by INTEGER REFERENCES public.usuarios(id),
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_wa_connect_links_expires ON public.wa_connect_links(expires_at);
    `);

    await client.query('COMMIT');
    console.log('[tracking-schema] Schema de captação verificado/criado.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function ensureTrackingSchema() {
  if (!schemaPromise) {
    schemaPromise = createTrackingSchema().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
