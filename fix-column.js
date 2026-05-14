const { getPool } = require('./api/_db.js');

async function fix() {
  const pool = getPool();
  try {
    console.log('⏳ Injetando coluna mensagem_template...');
    await pool.query('ALTER TABLE relatorios_agendados ADD COLUMN IF NOT EXISTS mensagem_template TEXT;');
    console.log('✅ Coluna mensagem_template injetada com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao injetar coluna:', err.message);
  } finally {
    process.exit(0);
  }
}

fix();
