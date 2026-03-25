import { verifyAuth } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req, res);
  if (!user) return;

  let body = '';
  await new Promise(r => { req.on('data', d => body += d); req.on('end', r); });

  const { token, client_name, visible_sections, visible_metrics, visible_columns, status_filter, expires_at } = JSON.parse(body || '{}');

  if (!token) return res.status(400).json({ error: 'token required' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const updatePayload = { client_name, visible_sections, visible_metrics, visible_columns, status_filter };
  if (expires_at !== undefined) {
    updatePayload.expires_at = expires_at === '' ? null : (expires_at ? new Date(expires_at).toISOString() : null);
  }

  const { data, error } = await sb
    .from('share_tokens')
    .update(updatePayload)
    .eq('token', token)
    .eq('user_id', user.id)
    .select('token')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Token não encontrado ou sem permissão' });
  return res.status(200).json({ ok: true });
}
