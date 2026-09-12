import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

// Remove a tabela órfã `relatorios_agendados` (feature "Novo Relatório" descontinuada
// em favor de zap_destinos/zap_agendamentos — ver CLAUDE.md, seção "Relatórios
// Automáticos (Zap) em 2 níveis"). Sem frontend, sem cron, sem endpoint desde a
// remoção de api/reports-config.js e js/reports-auto.js.
//
// SEMPRE rodar a checagem de dados antes de aplicar em produção:
//   SELECT COUNT(*) FROM relatorios_agendados;
// Se houver linhas, avalie com o usuário antes de dropar — pode haver configurações
// antigas de cliente nunca migradas para o sistema novo.
//
// Uso:
//   DROP_DRY_RUN=true node -r dotenv/config scripts/migration/drop-relatorios-agendados.js
//   node -r dotenv/config scripts/migration/drop-relatorios-agendados.js

const DRY_RUN = process.env.DROP_DRY_RUN === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERRO: DATABASE_URL não foi definida no arquivo .env');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const check = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'relatorios_agendados'
      ) AS existe
    `);

    if (!check.rows[0].existe) {
      console.log('ℹ️  Tabela "relatorios_agendados" não existe — nada a fazer.');
      process.exit(0);
    }

    const count = await client.query('SELECT COUNT(*) FROM relatorios_agendados');
    const total = parseInt(count.rows[0].count, 10);
    console.log(`📊 Registros encontrados em "relatorios_agendados": ${total}`);

    if (total > 0) {
      console.warn('⚠️  A tabela contém dados. Revise antes de continuar — este script NÃO');
      console.warn('   aborta automaticamente, mas confirme que não há configuração real');
      console.warn('   de cliente presa aqui antes de prosseguir.');
    }

    if (DRY_RUN) {
      console.log('🔍 DRY RUN — nenhuma alteração aplicada. Rode sem DROP_DRY_RUN=true para dropar.');
      process.exit(0);
    }

    await client.query('DROP TABLE IF EXISTS public.relatorios_agendados;');
    console.log('✅ Tabela "relatorios_agendados" removida com sucesso.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro ao remover tabela:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
