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
  const {
    account_id,
    account_name,
    client_name,
    visible_sections,
    visible_metrics,
    visible_columns,
    status_filter,
  } = JSON.parse(body || '{}');

  if (!account_id) return res.status(400).json({ error: 'account_id required' });

  // Verify account_id belongs to the configured META_ADS_TOKEN
  const metaToken = process.env.META_ADS_TOKEN;
  if (!metaToken) return res.status(500).json({ error: 'META_ADS_TOKEN not configured' });
  try {
    const check = await fetch(`https://graph.facebook.com/v20.0/${account_id}?fields=id&access_token=${metaToken}`);
    const checkData = await check.json();
    if (checkData.error) return res.status(403).json({ error: 'Conta inválida ou sem acesso' });
  } catch {
    return res.status(500).json({ error: 'Erro ao verificar conta' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const token = randomUUID();

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1); // expira em 1 ano

  const { error } = await sb.from('share_tokens').insert({
    token,
    account_id,
    account_name: account_name || account_id,
    user_id: user.id,
    client_name: client_name || null,
    visible_sections: visible_sections || null,
    visible_metrics: visible_metrics || null,
    visible_columns: visible_columns || null,
    status_filter: status_filter || 'ACTIVE',
    expires_at: expiresAt.toISOString(),
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ token });
}
