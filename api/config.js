export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Exposes only public config
  return res.status(200).json({
    projectName: process.env.PROJECT_NAME || 'Adlytics'
  });
}
