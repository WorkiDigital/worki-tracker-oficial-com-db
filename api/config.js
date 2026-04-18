import { cors } from './_cors.js';
import { getPool } from './_db.js';

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS public.configuracoes_sistema (
    id SERIAL PRIMARY KEY,
    chave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;

  let projectName = process.env.PROJECT_NAME || 'Adlytics';
  let projectLogo = null;

  try {
    const pool = getPool();
    // Auto-cria tabela se não existir
    await pool.query(ENSURE_TABLE);

    const result = await pool.query('SELECT chave, valor FROM configuracoes_sistema');
    const configs = {};
    result.rows.forEach(row => { configs[row.chave] = row.valor; });
    
    if (configs.projeto_nome) projectName = configs.projeto_nome;
    if (configs.projeto_logo) projectLogo = configs.projeto_logo;
  } catch (err) {
    console.error('Config API Load Error:', err.message);
  }

  return res.status(200).json({
    projectName,
    projectLogo
  });
}
