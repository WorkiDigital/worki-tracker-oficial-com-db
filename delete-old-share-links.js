import 'dotenv/config';
import pkg from 'pg';

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL nao definida.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function main() {
  try {
    const result = await pool.query(
      `
        DELETE FROM share_tokens
        WHERE expires_at IS NULL
        RETURNING token, account_id
      `
    );

    console.log(`Links antigos permanentes excluidos: ${result.rowCount}`);
  } catch (error) {
    console.error('Erro ao excluir links antigos:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
