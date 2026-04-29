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
    // Criação da tabela de Clientes (Multi-Tenant)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.clientes (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(255) NOT NULL,
          email_contato VARCHAR(255),
          pixel_padrao VARCHAR(255),
          token_meta TEXT,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // Migração: ampliar ctw_aci_id para TEXT (ctwaClid pode ter >255 chars)
    await client.query(`
      ALTER TABLE public.leads_tracking
      ALTER COLUMN ctw_aci_id TYPE TEXT;
    `);
    console.log('✅ Coluna ctw_aci_id migrada para TEXT.');

    // Template de venda configurável por cliente
    await client.query(`
      ALTER TABLE public.clientes
      ADD COLUMN IF NOT EXISTS template_venda TEXT;
    `);
    console.log('✅ Coluna "template_venda" injetada na tabela "clientes".');

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
