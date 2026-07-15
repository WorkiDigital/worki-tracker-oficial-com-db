import { verifyAuth, getTokenForUser } from './_auth.js';
import { getClientAccountId } from './_validate.js';
import { getPool } from './_db.js';
import { cacheGet, cacheSet, userCacheKey } from './_cache.js';
import { fetchMeta } from './_meta-client.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const token = await getTokenForUser(user);
  if (!token) return res.status(403).json({ error: 'Token Meta não configurado para sua conta. Solicite ao administrador da plataforma.' });

  // ── Cache hit? (contas mudam raramente — TTL 120s) ───────────
  const scopedClienteId = user.is_admin && req.query.cliente_id
    ? String(req.query.cliente_id)
    : '';
  const ck = userCacheKey(user, 'accounts', req.query.scope || 'all', scopedClienteId || 'self');
  const cached = await cacheGet(ck);
  if (cached) return res.status(200).json(cached);

  try {
    // Busca todas as páginas (Meta pagina por padrão em 25)
    const todas = [];
    let url = `https://graph.facebook.com/v20.0/me/adaccounts?fields=id,name,account_id,account_status,currency&limit=200&access_token=${token}`;

    while (url) {
      const r = await fetchMeta(url);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      todas.push(...(data.data || []));
      url = data.paging?.next || null; // segue para próxima página se existir
    }

    // Para clientes (não-admin): filtra apenas a conta vinculada no painel
    let targetClientAccountId = null;
    if (user.is_admin && req.query.cliente_id) {
      try {
        const pool = getPool();
        const r = await pool.query('SELECT account_id FROM clientes WHERE id = $1', [req.query.cliente_id]);
        targetClientAccountId = r.rows[0]?.account_id || null;
      } catch (_) {}
    }

    if (user.is_admin && req.query.cliente_id && !targetClientAccountId) {
      return res.status(200).json([]);
    }
    const allowedId = targetClientAccountId || await getClientAccountId(user);
    if (!user.is_admin && !allowedId && process.env.ALLOW_UNSCOPED_CLIENT_ACCOUNTS !== 'true') {
      return res.status(403).json({ error: 'Conta de anúncios não vinculada ao cliente.' });
    }
    const lista = allowedId
      ? todas.filter(a => String(a.account_id) === String(allowedId).replace(/^act_/, '') ||
                          String(a.id) === `act_${String(allowedId).replace(/^act_/, '')}`)
      : todas;

    // scope=configured: filtra às contas cadastradas em "Integrações" (clientes.account_id)
    if (req.query.scope === 'configured' && user.is_admin) {
      try {
        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT DISTINCT account_id FROM clientes WHERE account_id IS NOT NULL AND account_id <> ''`
        );
        if (rows.length > 0) {
          const configuredIds = new Set(rows.map(r => String(r.account_id).replace(/^act_/, '')));
          const filtrada = lista.filter(a => configuredIds.has(String(a.account_id)));
          if (filtrada.length > 0) lista.splice(0, lista.length, ...filtrada);
        }
      } catch (_) {}
    }

    lista.sort((a, b) => a.name.localeCompare(b.name));
    await cacheSet(ck, lista, 120000); // 120s TTL
    return res.status(200).json(lista);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
