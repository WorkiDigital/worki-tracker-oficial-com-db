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
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // O pg emite "error" quando uma conexão ociosa é derrubada pelo banco/rede.
    // Sem listener, esse evento encerra o processo Node e o proxy responde 502.
    pool.on('error', (error) => {
      console.error('[DB POOL] Conexão ociosa perdida:', error.message);
    });
  }
  return pool;
}
