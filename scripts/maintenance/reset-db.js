import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function reset() {
  console.log('⏳ Conectando ao Banco de Dados para DESTRUIR e RECRIAR a base do zero...');
  
  if (!process.env.DATABASE_URL) {
      console.error('❌ ERRO: DATABASE_URL não declarada');
      process.exit(1);
  }

  try {
    const client = await pool.connect();

    // 1. Zera banco com CASCADE (Remove dependências na ordem reversa de segurança)
    console.log('🧨 Limpando todo o banco atual (DROP TABLE CASCADE)...');
    await client.query(`
      DROP TABLE IF EXISTS public.share_tokens CASCADE;
      DROP TABLE IF EXISTS public.leads_tracking CASCADE;
      DROP TABLE IF EXISTS public.usuarios CASCADE;
      DROP TABLE IF EXISTS public.clientes CASCADE;
    `);

    console.log('✅ Base zerada! Iniciando criação limpa das tabelas (SaaS Multi-Tenant)...');

    // 2. Tabela de Clientes
    await client.query(`
      CREATE TABLE public.clientes (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(255) NOT NULL,
          email_contato VARCHAR(255),
          pixel_padrao VARCHAR(255),
          token_meta TEXT,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "clientes" restaurada.');

    // 3. Tabela de Usuários (com permissões)
    await client.query(`
      CREATE TABLE public.usuarios (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          senha_hash VARCHAR(255) NOT NULL,
          cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE SET NULL,
          is_admin BOOLEAN DEFAULT FALSE,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "usuarios" restaurada.');

    // 4. Tabela de Leads
    await client.query(`
      CREATE TABLE public.leads_tracking (
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
          valor_venda NUMERIC(10,2),
          cliente_id INTEGER REFERENCES public.clientes(id) ON DELETE SET NULL
      );
    `);
    console.log('✅ Tabela "leads_tracking" restaurada.');

    // 5. Tabela de Share Tokens
    await client.query(`
      CREATE TABLE public.share_tokens (
          token VARCHAR(255) PRIMARY KEY,
          account_id VARCHAR(255) NOT NULL,
          account_name VARCHAR(255),
          user_id INTEGER REFERENCES public.usuarios(id) ON DELETE CASCADE,
          client_name VARCHAR(255),
          visible_sections JSONB,
          visible_metrics JSONB,
          visible_columns JSONB,
          status_filter VARCHAR(50) DEFAULT 'ACTIVE',
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "share_tokens" restaurada.');

    client.release();
    console.log('🚀 Fim glorioso! Seu banco está 100% novo. Agora você pode se cadastrar no site e virar Admin!');
    process.exit(0);

  } catch (err) {
    console.error('❌ Erro brutal ao destruir/criar tabelas:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

reset();
