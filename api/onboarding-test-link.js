// GET /api/onboarding-test-link?slug=<slug>
// Testa, do lado do servidor, se o link rastreável recém-criado (etapa 4 do
// wizard) responde e redireciona corretamente — sem registrar um clique de
// teste como se fosse real (ver header X-Onboarding-Test em api/redirect.js).
//
// Chamado a partir do servidor (não do navegador) para evitar CORS e para não
// deixar o redirect automático do browser mascarar o status HTTP real.
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const slug = String(req.query.slug || '').trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    return res.status(400).json({ ok: false, motivo: 'Slug inválido.' });
  }

  const porta = process.env.PORT || 3000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);

  try {
    const r = await fetch(`http://localhost:${porta}/redirect/${encodeURIComponent(slug)}`, {
      redirect: 'manual',
      headers: { 'X-Onboarding-Test': '1' },
      signal: ctrl.signal,
    });

    if (r.status >= 300 && r.status < 400) {
      return res.status(200).json({ ok: true, motivo: 'Link funcionando — redireciona corretamente para o WhatsApp.' });
    }
    if (r.status === 200) {
      // api/redirect.js responde 200 (não 3xx) quando o teste de onboarding
      // é bem-sucedido, ver desvio isOnboardingTest.
      return res.status(200).json({ ok: true, motivo: 'Link funcionando — redireciona corretamente para o WhatsApp.' });
    }
    if (r.status === 404) {
      return res.status(200).json({ ok: false, motivo: 'Link não encontrado ou desativado.' });
    }
    if (r.status === 503) {
      return res.status(200).json({ ok: false, motivo: 'Nenhum destino de WhatsApp disponível para esse link ainda.' });
    }
    return res.status(200).json({ ok: false, motivo: 'Erro inesperado ao testar o link.' });
  } catch (e) {
    return res.status(200).json({ ok: false, motivo: 'Não foi possível testar o link agora. Tente novamente.' });
  } finally {
    clearTimeout(timer);
  }
}
