import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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
      if (!email_contato) return res.status(400).json({ error: 'Email de contato é obrigatório' });
      if (!senha_acesso) return res.status(400).json({ error: 'Senha de acesso é obrigatória' });
      if (!pixel_padrao) return res.status(400).json({ error: 'Pixel Padrão é obrigatório — cada cliente tem seu próprio pixel' });
      if (!token_meta) return res.status(400).json({ error: 'Token Meta é obrigatório — cada cliente tem seu próprio token de acesso' });

      try {
          // 1. Cria a configuração raiz do Cliente
          const clientResult = await pool.query(
              'INSERT INTO clientes (nome, email_contato, pixel_padrao, token_meta) VALUES ($1, $2, $3, $4) RETURNING id',
              [nome, email_contato, pixel_padrao, token_meta]
          );
          const cliente_id = clientResult.rows[0].id;

          // 2. Cria o usuário com Acesso Restrito (Login e Senha do cliente) amarrado ao ID dele
          const salt = await bcrypt.genSalt(10);
          const hash = await bcrypt.hash(senha_acesso, salt);
          await pool.query(
              'INSERT INTO usuarios (email, senha_hash, cliente_id, is_admin) VALUES ($1, $2, $3, false)',
              [email_contato, hash, cliente_id]
          );

          return res.status(201).json({ message: 'Cliente registrado com Conta de Acesso criada!', cliente_id });
      } catch (err) {
          console.error(err);
          if (err.code === '23505') { // constraint violation (ex: email ja existe)
             return res.status(400).json({ error: 'Este e-mail de acesso já está sendo usado por outro cliente.'});
          }
          return res.status(500).json({ error: 'Erro ao criar cliente. Verifique o console.' });
      }
  }

  if (req.method === 'PATCH') {
      const { id, nome, email_contato, pixel_padrao, token_meta, senha_acesso, permissoes } = req.body;
      if (!id) return res.status(400).json({ error: 'ID do cliente é obrigatório' });

      try {
          // Campos dinâmicos da tabela clientes
          const fields = [];
          const values = [];
          let idx = 1;
          if (nome)         { fields.push(`nome=$${idx++}`);         values.push(nome); }
          if (email_contato){ fields.push(`email_contato=$${idx++}`);values.push(email_contato); }
          if (pixel_padrao) { fields.push(`pixel_padrao=$${idx++}`); values.push(pixel_padrao); }
          if (token_meta)   { fields.push(`token_meta=$${idx++}`);   values.push(token_meta); }
          if (permissoes)   { fields.push(`permissoes=$${idx++}`);   values.push(JSON.stringify(permissoes)); }

          if (fields.length > 0) {
              values.push(id);
              await pool.query(`UPDATE clientes SET ${fields.join(', ')} WHERE id=$${idx}`, values);
          }

          // Atualizar e-mail do usuário vinculado (se informado)
          if (email_contato) {
              await pool.query('UPDATE usuarios SET email=$1 WHERE cliente_id=$2 AND is_admin=false', [email_contato, id]);
          }

          // Atualizar senha do usuário vinculado (se informada)
          if (senha_acesso) {
              const salt = await bcrypt.genSalt(10);
              const hash = await bcrypt.hash(senha_acesso, salt);
              await pool.query('UPDATE usuarios SET senha_hash=$1 WHERE cliente_id=$2 AND is_admin=false', [hash, id]);
          }

          return res.status(200).json({ message: 'Cliente atualizado com sucesso!' });
      } catch (err) {
          console.error(err);
          if (err.code === '23505') {
              return res.status(400).json({ error: 'Este e-mail já está em uso por outro usuário.' });
          }
          return res.status(500).json({ error: 'Erro ao atualizar cliente.' });
      }
  }

  return res.status(405).json({ error: 'Método API invalido' });
}
