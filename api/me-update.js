// Atualiza a própria conta do usuário logado: email e/ou senha.
// Trocar senha exige a senha atual (validação). O admin do .env (id 0) não pode
// alterar conta aqui — a credencial dele vive no .env.
import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (cors(req, res, ['PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  // Admin do .env (id 0) não existe na tabela usuarios.
  if (!user.id) {
    return res.status(403).json({ error: 'Conta de administrador do sistema não pode ser editada pelo painel.' });
  }

  const { email, senhaAtual, novaSenha, onboarding_perfil, onboarding_completo } = req.body || {};
  const temCamposOnboarding = onboarding_perfil !== undefined || onboarding_completo !== undefined;
  if (!email && !novaSenha && !temCamposOnboarding) {
    return res.status(400).json({ error: 'Nada para atualizar.' });
  }

  try {
    const pool = getPool();

    // Busca o hash atual para validar a senha quando for trocar senha.
    const cur = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [user.id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const sets = [];
    const params = [];
    let i = 1;

    // Troca de email
    if (email && email !== user.email) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) return res.status(400).json({ error: 'E-mail inválido.' });
      // Garante unicidade
      const dupe = await pool.query('SELECT id FROM usuarios WHERE email = $1 AND id <> $2', [email, user.id]);
      if (dupe.rows.length) return res.status(409).json({ error: 'Este e-mail já está em uso.' });
      sets.push(`email = $${i++}`); params.push(email);
    }

    // Troca de senha — exige senha atual correta
    if (novaSenha) {
      if (!senhaAtual) return res.status(400).json({ error: 'Informe a senha atual.' });
      if (novaSenha.length < 6) return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' });
      const ok = await bcrypt.compare(senhaAtual, cur.rows[0].senha_hash);
      if (!ok) return res.status(401).json({ error: 'Senha atual incorreta.' });
      const hash = await bcrypt.hash(novaSenha, 10);
      sets.push(`senha_hash = $${i++}`); params.push(hash);
    }

    // Progresso do wizard de onboarding — gravado de forma otimista a cada
    // etapa concluída (perfil na etapa 1, conclusão total na etapa 7).
    if (onboarding_perfil !== undefined) {
      sets.push(`onboarding_perfil = $${i++}`); params.push(onboarding_perfil);
    }
    if (onboarding_completo === true) {
      sets.push(`onboarding_completo = $${i++}`); params.push(true);
    }

    if (!sets.length) return res.status(200).json({ ok: true, unchanged: true });

    params.push(user.id);
    await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${i}`, params);

    return res.status(200).json({ ok: true, email: email || user.email });
  } catch (error) {
    console.error('me-update error:', error);
    return res.status(500).json({ error: error.message || 'Erro ao atualizar a conta.' });
  }
}
