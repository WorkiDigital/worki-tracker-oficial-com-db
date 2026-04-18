import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Acesso negado: Requer privilégios de administrador.' });
  }

  const { projeto_nome, projeto_logo } = req.body;
  const pool = getPool();

  try {
    if (projeto_nome !== undefined) {
      await pool.query(`
        INSERT INTO configuracoes_sistema (chave, valor, atualizado_em)
        VALUES ('projeto_nome', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP
      `, [projeto_nome]);
    }

    if (projeto_logo !== undefined) {
      await pool.query(`
        INSERT INTO configuracoes_sistema (chave, valor, atualizado_em)
        VALUES ('projeto_logo', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP
      `, [projeto_logo]);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Config Update Error:', err);
    return res.status(500).json({ error: 'Erro ao salvar configurações.' });
  }
}
