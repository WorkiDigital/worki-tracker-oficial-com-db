import { getPool } from './_db.js';
import bcrypt from 'bcryptjs';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['POST'], { public: true })) return;

  const { email, password, registration_secret } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email inválido ou senha menor que 6 caracteres.' });
  }

  try {
    const pool = getPool();
    // Verifica se já existe
    const exists = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: 'Este email já está cadastrado.' });
    }

    // Verifica se é o primeiro usuário do sistema (que será o Admin mestre)
    const countRes = await pool.query('SELECT COUNT(*) as qtd FROM usuarios');
    const isAdmin = countRes.rows[0].qtd === '0';
    const isProduction = process.env.NODE_ENV === 'production';
    const allowPublicRegistration = process.env.ALLOW_PUBLIC_REGISTRATION === 'true';
    const allowPublicBootstrap = process.env.ALLOW_PUBLIC_BOOTSTRAP === 'true';
    const requiredSecret = process.env.REGISTRATION_SECRET;
    const receivedSecret = req.headers['x-registration-secret'] || registration_secret;

    if (isProduction && !isAdmin && !allowPublicRegistration) {
      return res.status(403).json({ error: 'Cadastro público desativado.' });
    }

    if (isProduction && isAdmin && !allowPublicBootstrap) {
      if (!requiredSecret || receivedSecret !== requiredSecret) {
        return res.status(403).json({ error: 'Bootstrap de admin exige REGISTRATION_SECRET.' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      'INSERT INTO usuarios (email, senha_hash, is_admin) VALUES ($1, $2, $3) RETURNING id, email, is_admin',
      [email, hash, isAdmin]
    );

    return res.status(201).json({ message: 'Conta criada com sucesso!', user: result.rows[0] });
  } catch (error) {
    console.error('Register error:', error);
    if (error.code === '42P01') {
       return res.status(500).json({ error: 'Tabela de usuarios não existe no banco de dados ainda.'});
    }
    return res.status(500).json({ error: 'Erro interno ao criar conta.' });
  }
}
