import pkg from 'pg';
const { Pool } = pkg;

let pool;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      console.warn("Aviso: DATABASE_URL não definida.");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}
