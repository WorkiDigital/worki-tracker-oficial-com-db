import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Bloqueio de Segurança Externa
  const user = await verifyAuth(req, res);
  if (!user) return; 

  // Bloqueio Multi-tenant: Apenas Donos/Admins podem manipular clientes
  if (!user.is_admin) {
      return res.status(403).json({ error: 'Acesso negado: Você não é administrador da plataforma.' });
  }

  const pool = getPool();

  if (req.method === 'GET') {
      try {
          // Lista todos os clientes para montar o painel Admin
          const result = await pool.query('SELECT * FROM clientes ORDER BY id DESC');
          return res.status(200).json(result.rows);
      } catch (err) {
          console.error(err);
          return res.status(500).json({ error: 'Erro ao listar clientes' });
      }
  }

  if (req.method === 'POST') {
      const { nome, email_contato, pixel_padrao, token_meta, senha_acesso } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome da Agência/Cliente é obrigatório' });

      try {
          // 1. Cria a configuração raiz do Cliente
          const clientResult = await pool.query(
              'INSERT INTO clientes (nome, email_contato, pixel_padrao, token_meta) VALUES ($1, $2, $3, $4) RETURNING id',
              [nome, email_contato, pixel_padrao, token_meta]
          );
          const cliente_id = clientResult.rows[0].id;

          // 2. Cria o usuário com Acesso Restrito (Login e Senha do cliente) amarrado ao ID dele
          if (email_contato && senha_acesso) {
              const salt = await bcrypt.genSalt(10);
              const hash = await bcrypt.hash(senha_acesso, salt);
              await pool.query(
                  'INSERT INTO usuarios (email, senha_hash, cliente_id, is_admin) VALUES ($1, $2, $3, false)',
                  [email_contato, hash, cliente_id]
              );
          }

          return res.status(201).json({ message: 'Cliente registrado com Conta de Acesso criada!', cliente_id });
      } catch (err) {
          console.error(err);
          if (err.code === '23505') { // constraint violation (ex: email ja existe)
             return res.status(400).json({ error: 'Este e-mail de acesso já está sendo usado por outro cliente.'});
          }
          return res.status(500).json({ error: 'Erro ao criar cliente. Verifique o console.' });
      }
  }

  return res.status(405).json({ error: 'Método API invalido' });
}
