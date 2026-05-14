import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupReports() {
  console.log('⏳ Conectando ao Banco de Dados para configurar Relatórios Automáticos...');
  
  if (!process.env.DATABASE_URL) {
      console.error('❌ ERRO: DATABASE_URL não foi definida no arquivo .env');
      process.exit(1);
  }

  try {
    const client = await pool.connect();
    console.log('✅ Conexão estabelecida. Criando tabela relatorios_agendados...');

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
          status BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabela "relatorios_agendados" verificada/criada com sucesso.');

    client.release();
    console.log('🚀 Finalizado! Estrutura do Banco de Dados pronta para relatórios.');
    process.exit(0);

  } catch (err) {
    console.error('❌ Erro ao criar tabela:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupReports();
