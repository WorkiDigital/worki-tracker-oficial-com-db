import { getTokenForUser, verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { randomUUID } from 'crypto';
import { verifyAccountAccess } from './_validate.js';
import { cors } from './_cors.js';

const DEFAULT_SHARE_TTL_DAYS = parseInt(process.env.SHARE_TOKEN_DEFAULT_TTL_DAYS || '30', 10);

export default async function handler(req, res) {
  if (cors(req, res, ['POST'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const {
    account_id,
    account_name,
    client_name,
    visible_sections,
    visible_metrics,
    visible_columns,
    status_filter,
    expires_at,
  } = req.body || {};

  if (!account_id) return res.status(400).json({ error: 'account_id required' });
  if (!(await verifyAccountAccess(user, account_id))) return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });

  // Use token associado ao cliente logado (já disponível via JWT auth)
  let metaToken = await getTokenForUser(user);
  if (!metaToken) return res.status(403).json({ error: 'Token Meta não configurado.' });

  try {
    const check = await fetch(`https://graph.facebook.com/v20.0/${account_id}?fields=id&access_token=${metaToken}`);
    const checkData = await check.json();
    if (checkData.error) return res.status(403).json({ error: 'Conta inválida ou sem acesso' });
  } catch {
    return res.status(500).json({ error: 'Erro ao verificar conta' });
  }

  const pool = getPool();
  const token = randomUUID();
  const defaultExpiresAt = new Date(Date.now() + DEFAULT_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const expiresAt = expires_at
    ? new Date(expires_at).toISOString()
    : (process.env.ALLOW_PERMANENT_SHARE_LINKS === 'true' ? null : defaultExpiresAt.toISOString());

  try {
    await pool.query(
      `INSERT INTO share_tokens (
        token, account_id, account_name, user_id, client_name, 
        visible_sections, visible_metrics, visible_columns, 
        status_filter, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        token, 
        account_id, 
        account_name || account_id, 
        user.id, 
        client_name || null,
        visible_sections ? JSON.stringify(visible_sections) : null,
        visible_metrics ? JSON.stringify(visible_metrics) : null,
        visible_columns ? JSON.stringify(visible_columns) : null,
        status_filter || 'ACTIVE',
        expiresAt
      ]
    );

    return res.status(200).json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar o link de compartilhamento' });
  }
}
