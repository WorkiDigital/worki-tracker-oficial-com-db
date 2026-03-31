import { getPool } from '../api/_db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Rate limiting: máx 10 tentativas falhas por IP a cada 15 min
const _attempts = new Map();
function _isBlocked(ip) {
  const e = _attempts.get(ip);
  if (!e) return false;
  if (Date.now() > e.resetAt) { _attempts.delete(ip); return false; }
  return e.count >= 10;
}
function _recordFail(ip) {
  const now = Date.now();
  const e = _attempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > e.resetAt) { e.count = 0; e.resetAt = now + 15 * 60 * 1000; }
  e.count++;
  _attempts.set(ip, e);
}
function _clearFail(ip) { _attempts.delete(ip); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const ip = ((req.headers['x-forwarded-for'] || '') + '').split(',')[0].trim()
             || req.socket?.remoteAddress || 'unknown';

  if (_isBlocked(ip)) {
    return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em 15 minutos.' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha obrigatórios.' });
  }

  try {
    const pool = getPool();
    const result = await pool.query('SELECT id, email, senha_hash, is_admin, cliente_id FROM usuarios WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      _recordFail(ip);
      return res.status(401).json({ error: 'Email ou senha incorretos.' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.senha_hash);

    if (!match) {
      _recordFail(ip);
      return res.status(401).json({ error: 'Email ou senha incorretos.' });
    }

    _clearFail(ip);

    // Busca permissões do cliente (se não for admin)
    let permissoes = { leads: true, anuncios: true, relatorios: true, whatsapp: true, config: true };
    if (!user.is_admin && user.cliente_id) {
        const cliRes = await pool.query('SELECT permissoes FROM clientes WHERE id = $1', [user.cliente_id]);
        if (cliRes.rows.length > 0 && cliRes.rows[0].permissoes) {
            permissoes = cliRes.rows[0].permissoes;
        }
    }

    const secret = process.env.JWT_SECRET || 'SECRET_LOCAL_DEV';
    const payload = {
        id: user.id,
        email: user.email,
        is_admin: user.is_admin,
        cliente_id: user.cliente_id,
        permissoes
    };
    const token = jwt.sign(payload, secret, { expiresIn: '7d' });

    return res.status(200).json({ 
        token, 
        user: payload
    });
  } catch (error) {
    console.error('Login error:', error);
    if (error.code === '42P01') {
        return res.status(500).json({ error: 'Tabela de usuarios não existe no banco de dados.'});
    }
    return res.status(500).json({ error: 'Erro interno ao fazer login.' });
  }
}
