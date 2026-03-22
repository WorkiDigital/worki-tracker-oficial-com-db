import { createClient } from '@supabase/supabase-js';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const table = process.env.SUPABASE_TABLE || 'rei_dos_colchoes';

  const { data, error } = await supabase
    .from(table)
    .select('*');

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data);
}
