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
      ADD COLUMN IF NOT EXISTS tracking_method VARCHAR(20);

      ALTER TABLE public.tracking_clicks
      ADD COLUMN IF NOT EXISTS instance_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255),
      ADD COLUMN IF NOT EXISTS fbclid VARCHAR(512),
      ADD COLUMN IF NOT EXISTS fbc VARCHAR(512),
      ADD COLUMN IF NOT EXISTS fbp VARCHAR(255),
      ADD COLUMN IF NOT EXISTS pageview_event_id VARCHAR(60),
      ADD COLUMN IF NOT EXISTS capi_web_status VARCHAR(20);

      ALTER TABLE public.tracking_campaigns
      ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255);

      ALTER TABLE public.clientes
      ADD COLUMN IF NOT EXISTS capi_pixel_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS capi_token_enc BYTEA,
      ADD COLUMN IF NOT EXISTS capi_token_last4 VARCHAR(6),
      ADD COLUMN IF NOT EXISTS capi_token_updated_at TIMESTAMP;

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
