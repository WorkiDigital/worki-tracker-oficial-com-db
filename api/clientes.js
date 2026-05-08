import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import bcrypt from 'bcryptjs';
import { cors } from './_cors.js';
import { encryptToken } from './_crypto.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;

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
          // Lista todos os clientes para montar o painel Admin (EXCLUI token_meta por segurança)
          const result = await pool.query('SELECT id, nome, email_contato, pixel_padrao, account_id, permissoes, template_venda, criado_em FROM clientes ORDER BY id DESC');
          return res.status(200).json(result.rows);
      } catch (err) {
          console.error(err);
          return res.status(500).json({ error: 'Erro ao listar clientes' });
      }
  }

  if (req.method === 'POST') {
      const { nome, email_contato, pixel_padrao, senha_acesso } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome da Agência/Cliente é obrigatório' });
      if (!email_contato) return res.status(400).json({ error: 'Email de contato é obrigatório' });
      if (!senha_acesso) return res.status(400).json({ error: 'Senha de acesso é obrigatória' });
      if (!pixel_padrao) return res.status(400).json({ error: 'Pixel Padrão é obrigatório — cada cliente tem seu próprio pixel' });

      try {
          // 1. Cria a configuração raiz do Cliente
          const { token_meta } = req.body;
          let token_meta_enc = null;
          let token_last4 = null;
          if (token_meta) {
              token_meta_enc = encryptToken(token_meta);
              token_last4 = token_meta.slice(-6);
          }

          const clientResult = await pool.query(
              'INSERT INTO clientes (nome, email_contato, pixel_padrao, token_meta_enc, token_last4, token_updated_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
              [nome, email_contato, pixel_padrao, token_meta_enc, token_last4, token_meta ? new Date() : null]
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
      const { id, nome, email_contato, pixel_padrao, token_meta, account_id, senha_acesso, permissoes, template_venda } = req.body;
      if (!id) return res.status(400).json({ error: 'ID do cliente é obrigatório' });

      try {
          // Campos dinâmicos da tabela clientes
          const fields = [];
          const values = [];
          let idx = 1;
          if (nome)         { fields.push(`nome=$${idx++}`);         values.push(nome); }
          if (email_contato){ fields.push(`email_contato=$${idx++}`);values.push(email_contato); }
          if (pixel_padrao) { fields.push(`pixel_padrao=$${idx++}`); values.push(pixel_padrao); }
          if (token_meta)   { 
              fields.push(`token_meta_enc=$${idx++}`);   values.push(encryptToken(token_meta)); 
              fields.push(`token_last4=$${idx++}`);     values.push(token_meta.slice(-6));
              fields.push(`token_updated_at=$${idx++}`); values.push(new Date());
              // Opcional: Manter retrocompatibilidade (gravando texto puro por enquanto se desejar, 
              // mas a instrução diz para virar BYTEA. Aqui apenas seguimos a nova lógica)
          }
          if (account_id !== undefined) { fields.push(`account_id=$${idx++}`); values.push(account_id || null); }
          if (permissoes)   { fields.push(`permissoes=$${idx++}`);   values.push(JSON.stringify(permissoes)); }
          if (template_venda !== undefined) { fields.push(`template_venda=$${idx++}`); values.push(template_venda || null); }
          fields.push(`atualizado_em=$${idx++}`); values.push(new Date());

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

  if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'ID obrigatório' });
      try {
          await pool.query('DELETE FROM usuarios WHERE cliente_id=$1 AND is_admin=false', [id]);
          await pool.query('DELETE FROM leads_tracking WHERE cliente_id=$1', [id]);
          const r = await pool.query('DELETE FROM clientes WHERE id=$1 RETURNING id', [id]);
          if (r.rowCount === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
          return res.status(200).json({ message: 'Cliente excluído com sucesso' });
      } catch(err) {
          console.error(err);
          return res.status(500).json({ error: 'Erro ao excluir cliente' });
      }
  }

  return res.status(405).json({ error: 'Método API invalido' });
}
