import { verifyAuth, getTokenForUser } from './_auth.js';
import { getClientAccountId } from './_validate.js';
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
  const ck = userCacheKey(user, 'accounts');
  const cached = await cacheGet(ck);
  if (cached) return res.status(200).json(cached);

  try {
    // Busca todas as páginas (Meta pagina por padrão em 25)
    const todas = [];
    let url = `https://graph.facebook.com/v20.0/me/adaccounts?fields=id,name,account_id,account_status&limit=200&access_token=${token}`;

    while (url) {
      const r = await fetchMeta(url);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      todas.push(...(data.data || []));
      url = data.paging?.next || null; // segue para próxima página se existir
    }

    // Para clientes (não-admin): filtra apenas a conta vinculada no painel
    const allowedId = await getClientAccountId(user);
    const lista = allowedId
      ? todas.filter(a => String(a.account_id) === String(allowedId).replace(/^act_/, '') ||
                          String(a.id) === `act_${String(allowedId).replace(/^act_/, '')}`)
      : todas;

    lista.sort((a, b) => a.name.localeCompare(b.name));
    await cacheSet(ck, lista, 120000); // 120s TTL
    return res.status(200).json(lista);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
