import { cors } from './_cors.js';
import { getPool } from './_db.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;

  let projectName = process.env.PROJECT_NAME || 'Adlytics';
  let projectLogo = null;

  try {
    const pool = getPool();
    const result = await pool.query('SELECT chave, valor FROM configuracoes_sistema');
    const configs = {};
    result.rows.forEach(row => { configs[row.chave] = row.valor; });
    
    if (configs.projeto_nome) projectName = configs.projeto_nome;
    if (configs.projeto_logo) projectLogo = configs.projeto_logo;
  } catch (err) {
    // Tabela pode não existir ainda ou erro de banco, segue com defaults
    console.error('Config API Load Error:', err.message);
  }

  return res.status(200).json({
    projectName,
    projectLogo
  });
}
