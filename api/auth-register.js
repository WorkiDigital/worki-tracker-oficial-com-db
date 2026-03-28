import { getPool } from './_db.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { email, password } = req.body || {};
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

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      'INSERT INTO usuarios (email, senha_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
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
