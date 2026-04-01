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

    // Adicionando coluna de permissões na tabela clientes
    await client.query(`
      ALTER TABLE public.clientes
      ADD COLUMN IF NOT EXISTS permissoes JSONB DEFAULT '{"leads":true,"anuncios":true,"relatorios":true,"whatsapp":true,"config":true}';
    `);
    console.log('✅ Coluna "permissoes" injetada na tabela "clientes".');

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

    // Campos extras de venda na tabela leads_tracking
    await client.query(`
      ALTER TABLE public.leads_tracking
      ADD COLUMN IF NOT EXISTS produto VARCHAR(255),
      ADD COLUMN IF NOT EXISTS endereco TEXT,
      ADD COLUMN IF NOT EXISTS cor VARCHAR(100),
      ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(100),
      ADD COLUMN IF NOT EXISTS cpf VARCHAR(20);
    `);
    console.log('✅ Campos de venda (produto, endereco, cor, forma_pagamento, cpf) injetados em "leads_tracking".');

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
