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
          ctw_aci_id VARCHAR(255),
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
