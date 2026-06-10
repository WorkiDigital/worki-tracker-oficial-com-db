import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // No Easypanel e Railway, conexões externas muitas vezes exigem ssl
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setup() {
  console.log('⏳ Conectando ao Banco de Dados...');
  if (!process.env.DATABASE_URL) {
      console.error('❌ ERRO: DATABASE_URL não foi definida no arquivo .env');
      process.exit(1);
  }

  // Verificação de segurança: Chave de Criptografia
  if (!process.env.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY.length !== 64) {
    console.error('❌ TOKEN_ENCRYPTION_KEY ausente ou inválida no .env.');
    console.error('👉 Gere uma chave de 64 caracteres hex (32 bytes) com: openssl rand -hex 32');
    process.exit(1);
  }

  try {
    const client = await pool.connect();
    console.log('✅ Conexão estabelecida. Iniciando criação de tabelas...');

    // Criação da tabela de Usuários
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.usuarios (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          senha_hash VARCHAR(255) NOT NULL,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "usuarios" verificada/criada.');

    // Criação da tabela de Leads
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.leads_tracking (
          id SERIAL PRIMARY KEY,
          event_time TIMESTAMP,
          nome VARCHAR(255),
          telefone VARCHAR(50),
          mensagem_recebida TEXT,
          instancia VARCHAR(100),
          plataforma VARCHAR(100),
          utm_campaign VARCHAR(255),
          utm_medium VARCHAR(255),
          utm_content VARCHAR(255),
          pixel VARCHAR(100),
          token TEXT,
          source_id VARCHAR(255),
          page_id VARCHAR(100),
          ctw_aci_id TEXT,
          event_source_url TEXT,
          anuncio_thumbnail_url TEXT,
          status VARCHAR(50) DEFAULT 'Pendente',
          cidade VARCHAR(100),
          estado VARCHAR(100),
          pais VARCHAR(100),
          valor_venda NUMERIC(10,2)
      );
    `);
    // Índices de Performance para Leads
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_cliente_data ON leads_tracking(cliente_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_telefone ON leads_tracking(telefone);`);
    console.log('✅ Índices de performance criados em "leads_tracking".');
    // Criação da tabela de Clientes (Multi-Tenant)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.clientes (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(255) NOT NULL,
          email_contato VARCHAR(255),
          pixel_padrao VARCHAR(255),
          token_meta TEXT,
          token_meta_enc BYTEA,
          token_last4 VARCHAR(6),
          token_updated_at TIMESTAMP,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "clientes" (SaaS) verificada/criada.');

    // Adicionando vínculos na tabela Usuários
    await client.query(`
      ALTER TABLE public.usuarios 
      ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES public.clientes(id),
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
    `);
    console.log('✅ Permissões de agência (cliente_id, is_admin) injetadas na tabela "usuarios".');

    // Adicionando vínculo na tabela Leads_Tracking
    await client.query(`
      ALTER TABLE public.leads_tracking
      ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES public.clientes(id);
    `);
    console.log('✅ Vínculo de agência injetado na tabela "leads_tracking".');

    // Adicionando colunas extras na tabela clientes
    await client.query(`
      ALTER TABLE public.clientes
      ADD COLUMN IF NOT EXISTS permissoes JSONB DEFAULT '{"leads":true,"anuncios":true,"relatorios":true,"whatsapp":true,"config":true}',
      ADD COLUMN IF NOT EXISTS account_id VARCHAR(255);
    `);
    console.log('✅ Colunas "permissoes" e "account_id" injetadas na tabela "clientes".');

    // Criação da tabela de Tokens de Compartilhamento
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.share_tokens (
          token VARCHAR(255) PRIMARY KEY,
          account_id VARCHAR(255) NOT NULL,
          account_name VARCHAR(255),
          user_id INTEGER REFERENCES public.usuarios(id),
          client_name VARCHAR(255),
          visible_sections JSONB,
          visible_metrics JSONB,
          visible_columns JSONB,
          status_filter VARCHAR(50) DEFAULT 'ACTIVE',
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "share_tokens" verificada/criada.');

    // Tabela de mapeamento: instâncias externas da Evolution → cliente
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.instancias_mapeamento (
          id SERIAL PRIMARY KEY,
          instance_name VARCHAR(255) UNIQUE NOT NULL,
          cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "instancias_mapeamento" verificada/criada.');

    // Tabela de agendamentos de relatórios via WhatsApp
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.zap_agendamentos (
        id            SERIAL PRIMARY KEY,
        cliente_id    INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        instance_name VARCHAR(255) NOT NULL,
        destino_tipo  VARCHAR(20)  DEFAULT 'grupo',
        destino_jid   VARCHAR(255) NOT NULL,
        destino_nome  VARCHAR(255),
        template      TEXT,
        frequencia    VARCHAR(50)  DEFAULT 'diario',
        horario       TIME         NOT NULL DEFAULT '08:00',
        status        VARCHAR(20)  DEFAULT 'ativo',
        criado_em     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "zap_agendamentos" verificada/criada.');

    // Migração: coluna periodo em zap_agendamentos
    await client.query(`
      ALTER TABLE public.zap_agendamentos
      ADD COLUMN IF NOT EXISTS periodo VARCHAR(50) DEFAULT 'yesterday';
    `);
    console.log('✅ Coluna "periodo" injetada na tabela "zap_agendamentos".');

    // Migração: coluna account_id em zap_agendamentos
    await client.query(`
      ALTER TABLE public.zap_agendamentos
      ADD COLUMN IF NOT EXISTS account_id VARCHAR(255);
    `);
    console.log('✅ Coluna "account_id" injetada na tabela "zap_agendamentos".');

    // Controle de idempotência do cron de relatórios Zap
    await client.query(`
      ALTER TABLE public.zap_agendamentos
      ADD COLUMN IF NOT EXISTS ultimo_envio_chave VARCHAR(32),
      ADD COLUMN IF NOT EXISTS ultimo_envio_em TIMESTAMPTZ;
    `);
    console.log('✅ Controle de último envio injetado na tabela "zap_agendamentos".');

    // Migração: ampliar ctw_aci_id para TEXT (ctwaClid pode ter >255 chars)
    await client.query(`
      ALTER TABLE public.leads_tracking
      ALTER COLUMN ctw_aci_id TYPE TEXT;
    `);
    console.log('✅ Coluna ctw_aci_id migrada para TEXT.');

      await client.query(`
        ALTER TABLE clientes 
        ADD COLUMN IF NOT EXISTS template_venda TEXT,
        ADD COLUMN IF NOT EXISTS template_qualificacao TEXT;
      `);
      console.log('✅ Colunas "template_venda" e "template_qualificacao" na tabela "clientes".');

    // Campos de venda (produto, endereco, cor, forma_pagamento, cpf, email) injetados em "leads_tracking".
    await client.query(`
      ALTER TABLE public.leads_tracking
      ADD COLUMN IF NOT EXISTS produto VARCHAR(255),
      ADD COLUMN IF NOT EXISTS endereco TEXT,
      ADD COLUMN IF NOT EXISTS cor VARCHAR(100),
      ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(100),
      ADD COLUMN IF NOT EXISTS cpf VARCHAR(20),
      ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    `);

    // NOVOS CAMPOS TEMPORAIS E SCORE (FASE 1)
    await client.query(`
      ALTER TABLE public.leads_tracking
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS proposal_sent_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS sale_closed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
    `);
    console.log('✅ Novos campos temporais e de score (Fase 1) injetados em "leads_tracking".');

    // Configurações Globais do Sistema (White-label)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.configuracoes_sistema (
          id SERIAL PRIMARY KEY,
          chave VARCHAR(100) UNIQUE NOT NULL,
          valor TEXT NOT NULL,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "configuracoes_sistema" verificada/criada.');

    // Tabela de Configurações do Dashboard (Cards, Colunas, etc por conta de anúncio)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.dashboard_settings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id INTEGER REFERENCES public.usuarios(id),
          ad_account_id VARCHAR(255) NOT NULL,
          metrics_cfg JSONB NOT NULL,
          demo_cfg JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, ad_account_id)
      );
    `);
    console.log('✅ Tabela "dashboard_settings" verificada/criada.');

    // Tabela de Cache de Métricas da Meta Ads
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.metrics_cache (
          id SERIAL PRIMARY KEY,
          cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
          account_id VARCHAR(50),
          data_referencia DATE,
          metrics JSONB,
          atualizado_em TIMESTAMP DEFAULT NOW(),
          UNIQUE(cliente_id, account_id, data_referencia)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_metrics_cache_lookup ON metrics_cache(cliente_id, account_id, data_referencia);`);
    console.log('✅ Tabela "metrics_cache" e índices verificados/criados.');

    // NOVO: Tabela de Logs (Webhook Logs)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.webhook_logs (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        instance VARCHAR(255),
        cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
        level VARCHAR(10) DEFAULT 'info',
        tag VARCHAR(50),
        message TEXT,
        data JSONB
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_logs_cliente_created ON webhook_logs(cliente_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_logs_tag ON webhook_logs(tag);`);
    console.log('✅ Tabela "webhook_logs" e índices verificados/criados.');

    // Dados iniciais de White-label (apenas se não existirem)
    const currentLogo = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><rect width="32" height="32" rx="8" fill="#3b82f6"/><rect x="6" y="18" width="4" height="8" rx="1.5" fill="white" opacity="0.6"/><rect x="12" y="13" width="4" height="13" rx="1.5" fill="white" opacity="0.8"/><rect x="18" y="8" width="4" height="18" rx="1.5" fill="white"/><polyline points="21,6 25,6 25,10" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><line x1="18" y1="9" x2="25" y2="6" stroke="white" stroke-width="1.8" stroke-linecap round/></svg>`;
    
    await client.query(`
      INSERT INTO configuracoes_sistema (chave, valor)
      VALUES 
        ('projeto_nome', 'Adlytics'),
        ('projeto_logo', $1)
      ON CONFLICT (chave) DO NOTHING;
    `, [currentLogo]);
    console.log('✅ Configurações iniciais de marca inseridas.');

    // Tabela de Agendamento de Relatórios no WhatsApp (Fase 1)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.relatorios_agendados (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
          instance_name VARCHAR(255) NOT NULL,
          target_jid VARCHAR(255) NOT NULL,
          is_group BOOLEAN DEFAULT FALSE,
          nome_destino VARCHAR(255),
          metricas JSONB NOT NULL DEFAULT '[]',
          frequencia VARCHAR(50) DEFAULT 'diario',
          horario_envio VARCHAR(10) NOT NULL,
          mensagem_template TEXT,
          status BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "relatorios_agendados" verificada/criada.');

    // MIGRATION: Adicionar colunas de criptografia caso a tabela já exista
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clientes' AND column_name='token_meta') THEN
          ALTER TABLE clientes ADD COLUMN IF NOT EXISTS token_meta_enc BYTEA;
          ALTER TABLE clientes ADD COLUMN IF NOT EXISTS token_last4 VARCHAR(6);
          ALTER TABLE clientes ADD COLUMN IF NOT EXISTS token_updated_at TIMESTAMP;
          ALTER TABLE clientes ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
          RAISE NOTICE 'Migração: colunas de criptografia verificadas/adicionadas';
        END IF;
      END $$;
    `);
    console.log('✅ Migração automática de criptografia concluída.');

    client.release();
    console.log('🚀 Finalizado! Estrutura do Banco de Dados pronta para uso.');
    process.exit(0);

  } catch (err) {
    console.error('❌ Erro crítico ao tentar criar tabelas:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setup();
