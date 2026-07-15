// GET /api/onboarding-status?cliente_id=<id>
// Verificação REAL de progresso do wizard de onboarding — cada sinal é um fato
// consultado no banco (ou na Evolution API), nunca "o usuário clicou em avançar".
// Usado pela tela final do wizard, pelo badge de checklist persistente, e por
// abrirWizardOnboarding() para decidir em qual etapa retomar.
import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

// Mesma detecção de "conectado" já usada em js/admin.js (formatos variam entre
// versões da Evolution API).
function estaConectado(data) {
  const state = data?.instance?.state || data?.state || '';
  return String(state).toLowerCase() === 'open';
}

async function checarWhatsappConectado(pool, clienteId) {
  if (!clienteId) return false;
  try {
    const inst = await pool.query(
      'SELECT instance_name FROM instancias_mapeamento WHERE cliente_id = $1 LIMIT 1',
      [clienteId]
    );
    if (!inst.rows.length) return false;

    const EVO_URL = process.env.EVOLUTION_API_URL;
    const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
    if (!EVO_URL || !EVO_KEY) return false;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const r = await fetch(`${EVO_URL}/instance/connectionState/${inst.rows[0].instance_name}`, {
        headers: { apikey: EVO_KEY },
        signal: ctrl.signal,
      });
      if (!r.ok) return false;
      const data = await r.json();
      return estaConectado(data);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // Evolution fora do ar/lenta não deve derrubar os outros sinais.
    return false;
  }
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  // Para admin, o cliente de referência vem do filtro ativo no painel
  // (clienteAdminSelecionado); para cliente comum, é o próprio cliente_id do JWT.
  const clienteId = user.is_admin ? (req.query.cliente_id || null) : user.cliente_id;

  const resultado = {
    cliente_criado: !user.is_admin, // cliente comum já É o cliente — sinal não se aplica
    whatsapp_conectado: false,
    tracking_criado: false,
    lead_recebido: false,
    conversao_configurada: false,
  };

  if (user.is_admin && !clienteId) {
    // Admin sem nenhum cliente selecionado/criado ainda — todos os sinais
    // dependentes de cliente ficam falsos, sem erro.
    try {
      const c = await pool.query('SELECT COUNT(*)::int AS qtd FROM clientes');
      resultado.cliente_criado = c.rows[0].qtd > 0;
    } catch (e) { /* mantém false */ }
    return res.status(200).json(resultado);
  }

  const checks = await Promise.allSettled([
    checarWhatsappConectado(pool, clienteId),
    pool.query('SELECT COUNT(*)::int AS qtd FROM tracking_campaigns WHERE cliente_id = $1 AND archived_at IS NULL', [clienteId]),
    pool.query('SELECT COUNT(*)::int AS qtd FROM leads_tracking WHERE cliente_id = $1', [clienteId]),
    pool.query('SELECT capi_pixel_id, google_ads_conversion_id FROM clientes WHERE id = $1', [clienteId]),
  ]);

  const [waResult, trackingResult, leadResult, conversaoResult] = checks;

  if (waResult.status === 'fulfilled') resultado.whatsapp_conectado = waResult.value;
  if (trackingResult.status === 'fulfilled') resultado.tracking_criado = trackingResult.value.rows[0].qtd > 0;
  if (leadResult.status === 'fulfilled') resultado.lead_recebido = leadResult.value.rows[0].qtd > 0;
  if (conversaoResult.status === 'fulfilled' && conversaoResult.value.rows.length) {
    const row = conversaoResult.value.rows[0];
    resultado.conversao_configurada = !!(row.capi_pixel_id || row.google_ads_conversion_id);
  }

  if (user.is_admin) {
    try {
      const c = await pool.query('SELECT COUNT(*)::int AS qtd FROM clientes');
      resultado.cliente_criado = c.rows[0].qtd > 0;
    } catch (e) { /* mantém false */ }
  }

  return res.status(200).json(resultado);
}
