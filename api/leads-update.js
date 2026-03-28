import { createClient } from '@supabase/supabase-js';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const { id, status, valor_venda } = req.body;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const table = process.env.SUPABASE_TABLE || 'rei_dos_colchoes';

  const updates = {};
  if (status)      updates.status      = status;
  if (valor_venda !== undefined) updates.valor_venda = valor_venda;

  const { error } = await sb.from(table).update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
