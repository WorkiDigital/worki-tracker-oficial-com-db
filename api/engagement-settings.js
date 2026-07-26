import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { requirePermission } from './_require-permission.js';
import { ensureEngagementSchema, getEngagementSettings, ENGAGEMENT_DEFAULTS } from './_engagement-schema.js';

const BUSINESS_DAYS_VALID = new Set([1, 2, 3, 4, 5, 6, 7]);
const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validar(body) {
  const erros = [];

  const botThreshold = Number(body.bot_threshold_seconds);
  if (!Number.isFinite(botThreshold) || botThreshold < 0 || botThreshold > 300) {
    erros.push('bot_threshold_seconds deve ser um número entre 0 e 300.');
  }

  if (body.business_hours_enabled) {
    if (!HHMM_REGEX.test(body.business_hours_start || '')) erros.push('business_hours_start inválido (use HH:MM).');
    if (!HHMM_REGEX.test(body.business_hours_end || '')) erros.push('business_hours_end inválido (use HH:MM).');
    if (!Array.isArray(body.business_days) || !body.business_days.length ||
        !body.business_days.every(d => BUSINESS_DAYS_VALID.has(Number(d)))) {
      erros.push('business_days deve ser uma lista de dias (1=segunda...7=domingo).');
    }
  }

  const pesos = [body.weight_first_response, body.weight_avg_response, body.weight_engagement_rate].map(Number);
  if (pesos.some(p => !Number.isFinite(p) || p < 0 || p > 100)) {
    erros.push('Os 3 pesos devem ser números entre 0 e 100.');
  } else if (pesos.reduce((a, b) => a + b, 0) !== 100) {
    erros.push('A soma dos 3 pesos deve ser exatamente 100.');
  }

  if (!Array.isArray(body.engagement_volume_tiers) || !body.engagement_volume_tiers.length) {
    erros.push('engagement_volume_tiers deve ser uma lista não vazia de faixas.');
  } else {
    for (const tier of body.engagement_volume_tiers) {
      if (!Number.isFinite(Number(tier.min)) || !Number.isFinite(Number(tier.score))) {
        erros.push('Cada faixa de engagement_volume_tiers precisa de min e score numéricos.');
        break;
      }
    }
  }

  return erros;
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'PUT'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (requirePermission(user, res, 'leads')) return;

  const alvoCliente = user.is_admin ? (req.query.cliente_id || req.body?.cliente_id) : user.cliente_id;
  if (!alvoCliente) return res.status(400).json({ error: 'cliente_id é obrigatório.' });
  if (!user.is_admin && Number(alvoCliente) !== Number(user.cliente_id)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  try {
    await ensureEngagementSchema();
    const pool = getPool();

    if (req.method === 'GET') {
      const settings = await getEngagementSettings(alvoCliente);
      return res.status(200).json(settings);
    }

    // PUT
    const erros = validar(req.body || {});
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });

    const {
      bot_threshold_seconds, business_hours_enabled, business_hours_start, business_hours_end,
      business_days, business_timezone, weight_first_response, weight_avg_response,
      weight_engagement_rate, engagement_volume_tiers,
    } = req.body;

    const r = await pool.query(
      `INSERT INTO engagement_settings
        (cliente_id, bot_threshold_seconds, business_hours_enabled, business_hours_start,
         business_hours_end, business_days, business_timezone, weight_first_response,
         weight_avg_response, weight_engagement_rate, engagement_volume_tiers, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (cliente_id) DO UPDATE SET
         bot_threshold_seconds = EXCLUDED.bot_threshold_seconds,
         business_hours_enabled = EXCLUDED.business_hours_enabled,
         business_hours_start = EXCLUDED.business_hours_start,
         business_hours_end = EXCLUDED.business_hours_end,
         business_days = EXCLUDED.business_days,
         business_timezone = EXCLUDED.business_timezone,
         weight_first_response = EXCLUDED.weight_first_response,
         weight_avg_response = EXCLUDED.weight_avg_response,
         weight_engagement_rate = EXCLUDED.weight_engagement_rate,
         engagement_volume_tiers = EXCLUDED.engagement_volume_tiers,
         updated_at = NOW()
       RETURNING *`,
      [
        alvoCliente,
        bot_threshold_seconds ?? ENGAGEMENT_DEFAULTS.bot_threshold_seconds,
        !!business_hours_enabled,
        business_hours_start || ENGAGEMENT_DEFAULTS.business_hours_start,
        business_hours_end || ENGAGEMENT_DEFAULTS.business_hours_end,
        business_days || ENGAGEMENT_DEFAULTS.business_days,
        business_timezone || ENGAGEMENT_DEFAULTS.business_timezone,
        weight_first_response,
        weight_avg_response,
        weight_engagement_rate,
        JSON.stringify(engagement_volume_tiers),
      ]
    );
    return res.status(200).json(r.rows[0]);
  } catch (err) {
    console.error('[engagement-settings]', err.message);
    return res.status(500).json({ error: 'Erro ao salvar configuração de engajamento.' });
  }
}
