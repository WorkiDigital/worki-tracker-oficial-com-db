import { getPool } from './_db.js';

// Configuração por cliente do Índice de Engajamento Comercial: limiar da
// heurística anti-bot, horário comercial (opt-in) e pesos/faixas do índice.
// Não obrigamos toda conta a ter uma linha — leitura sempre usa COALESCE
// com os defaults abaixo quando o cliente_id não tem config própria.
export const ENGAGEMENT_DEFAULTS = {
  bot_threshold_seconds: 5,
  business_hours_enabled: false,
  business_hours_start: '09:00',
  business_hours_end: '18:00',
  business_days: [1, 2, 3, 4, 5],
  business_timezone: 'America/Sao_Paulo',
  weight_first_response: 45,
  weight_avg_response: 35,
  weight_engagement_rate: 20,
  // Placeholder inicial — o usuário calibra com dados reais depois (ver CLAUDE.md).
  engagement_volume_tiers: [
    { min: 0, max: 3, score: 30 },
    { min: 4, max: 10, score: 65 },
    { min: 11, max: null, score: 100 },
  ],
};

let ensurePromise = null;

export function ensureEngagementSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('adlytics_engagement_schema_v1'))");
        await client.query(`
          CREATE TABLE IF NOT EXISTS public.engagement_settings (
            id SERIAL PRIMARY KEY,
            cliente_id INTEGER UNIQUE REFERENCES public.clientes(id) ON DELETE CASCADE,
            bot_threshold_seconds INTEGER NOT NULL DEFAULT 5,
            business_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            business_hours_start TIME NOT NULL DEFAULT '09:00',
            business_hours_end TIME NOT NULL DEFAULT '18:00',
            business_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
            business_timezone VARCHAR(50) NOT NULL DEFAULT 'America/Sao_Paulo',
            weight_first_response SMALLINT NOT NULL DEFAULT 45,
            weight_avg_response SMALLINT NOT NULL DEFAULT 35,
            weight_engagement_rate SMALLINT NOT NULL DEFAULT 20,
            engagement_volume_tiers JSONB NOT NULL DEFAULT '[
              {"min":0,"max":3,"score":30},
              {"min":4,"max":10,"score":65},
              {"min":11,"max":null,"score":100}
            ]'::jsonb,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

/** Retorna a config do cliente com fallback nos defaults globais (sem exigir linha própria). */
export async function getEngagementSettings(clienteId) {
  await ensureEngagementSchema();
  const pool = getPool();
  const r = await pool.query(
    'SELECT * FROM engagement_settings WHERE cliente_id = $1',
    [clienteId]
  );
  const row = r.rows[0];
  if (!row) return { cliente_id: clienteId, ...ENGAGEMENT_DEFAULTS };
  return row;
}
