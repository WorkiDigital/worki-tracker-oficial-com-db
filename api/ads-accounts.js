import { verifyAuth, getTokenForUser } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const token = await getTokenForUser(user);
  if (!token) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });

  try {
    // Busca todas as páginas (Meta pagina por padrão em 25)
    const todas = [];
    let url = `https://graph.facebook.com/v20.0/me/adaccounts?fields=id,name,account_id,account_status&limit=200&access_token=${token}`;

    while (url) {
      const r = await fetch(url);
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      todas.push(...(data.data || []));
      url = data.paging?.next || null; // segue para próxima página se existir
    }

    // Ordena por nome
    todas.sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json(todas);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
