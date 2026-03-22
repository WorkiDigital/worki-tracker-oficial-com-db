export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Exposes only what the frontend needs (never expose service key)
  return res.status(200).json({
    metaToken:       process.env.META_ACCESS_TOKEN || '',
    projectName:     process.env.PROJECT_NAME || 'Rei dos Colchões',
    supabaseUrl:     process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
}
