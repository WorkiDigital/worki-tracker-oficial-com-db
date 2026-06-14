// ENDPOINT TEMPORÁRIO DE DIAGNÓSTICO — remover após uso.
// Testa se o campo video_3_sec_watched_actions é aceito pela Meta na conta do usuário,
// em várias versões da Graph API. Acesse: /api/_test-video-field?accountId=act_XXXX
import { verifyAuth, getTokenForUser } from './_auth.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;
  const user = await verifyAuth(req, res);
  if (!user) return;

  const token = await getTokenForUser(user);
  if (!token) return res.status(403).json({ error: 'Token Meta não configurado.' });

  const accountId = req.query.accountId;
  if (!accountId) return res.status(400).json({ error: 'accountId obrigatório (ex: act_123...).' });

  // Campos de vídeo candidatos a testar, um por um.
  const camposTestar = [
    'video_3_sec_watched_actions',
    'video_play_actions',
    'video_thruplay_watched_actions',
    'video_p25_watched_actions',
  ];
  const versoes = ['v20.0', 'v23.0', 'v25.0'];

  const resultado = {};

  for (const versao of versoes) {
    resultado[versao] = {};
    for (const campo of camposTestar) {
      const fields = `insights.date_preset(last_30d){${campo}}`;
      const url = `https://graph.facebook.com/${versao}/${accountId}/campaigns`
        + `?fields=${encodeURIComponent(fields)}&limit=1&access_token=${token}`;
      try {
        const r = await fetch(url);
        const data = await r.json();
        if (data.error) {
          resultado[versao][campo] = `❌ ${data.error.message}`;
        } else {
          resultado[versao][campo] = '✅ aceito';
        }
      } catch (e) {
        resultado[versao][campo] = `erro: ${e.message}`;
      }
    }
  }

  return res.status(200).json({
    info: 'Diagnóstico de campos de vídeo por versão da Graph API. Endpoint temporário — remover depois.',
    accountId,
    resultado
  });
}
