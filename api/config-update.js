import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS public.configuracoes_sistema (
    id SERIAL PRIMARY KEY,
    chave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

function isSafeLogo(value) {
  const logo = String(value || '').trim();
  if (!logo) return true;
  if (logo.length > 100000) return false;
  if (logo.startsWith('<svg')) {
    return !/(<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:)/i.test(logo);
  }
  if (/^https?:\/\/[^\s"'<>]+$/i.test(logo)) return true;
  return /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(logo);
}

export default async function handler(req, res) {
  if (cors(req, res, ['PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Acesso negado: Requer privilégios de administrador.' });
  }

  const { projeto_nome, projeto_logo } = req.body;
  if (projeto_nome !== undefined && String(projeto_nome).length > 80) {
    return res.status(400).json({ error: 'Nome do projeto muito longo.' });
  }
  if (projeto_logo !== undefined && !isSafeLogo(projeto_logo)) {
    return res.status(400).json({ error: 'Logo inválido ou inseguro.' });
  }
  const pool = getPool();

  try {
    // Auto-cria tabela se não existir
    await pool.query(ENSURE_TABLE);

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
