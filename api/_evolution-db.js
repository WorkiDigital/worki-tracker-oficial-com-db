// Pool isolado para o PostgreSQL PRÓPRIO da Evolution API — nunca o mesmo banco
// do Worki Tracker (DATABASE_URL). Usado exclusivamente pelo fluxo de Session
// Transfer para ler/gravar em "Instance"/"Session". Se EVOLUTION_DATABASE_URL
// não estiver configurada, retorna null (o chamador deve tratar como 503) em
// vez de construir um Pool com connection string vazia.
import pkg from 'pg';
const { Pool } = pkg;

let evoPool;

export function getEvolutionPool() {
  if (!process.env.EVOLUTION_DATABASE_URL) return null;
  if (!evoPool) {
    evoPool = new Pool({
      connectionString: process.env.EVOLUTION_DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    evoPool.on('error', (error) => {
      console.error('[EVOLUTION DB POOL] Conexão ociosa perdida:', error.message);
    });
  }
  return evoPool;
}
