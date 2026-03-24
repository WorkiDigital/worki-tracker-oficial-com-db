import { verifyAuth } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  let body = '';
  await new Promise(r => { req.on('data', d => body += d); req.on('end', r); });
  const { account_id, account_name } = JSON.parse(body || '{}');

  if (!account_id) return res.status(400).json({ error: 'account_id required' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const token = randomUUID();

  const { error } = await sb.from('share_tokens').insert({
    token, account_id, account_name: account_name || account_id, user_id: user.id
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ token });
}
