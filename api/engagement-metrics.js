import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { requirePermission } from './_require-permission.js';
import { getEngagementSettings } from './_engagement-schema.js';
import { ensureChatMessagesSchema } from './_chat-schema.js';
import { calcBusinessMinutes } from './_business-hours.js';

// ── Índice de Engajamento Comercial ──────────────────────────────────────────
// Combina 3 sinais (Primeira Resposta humana, Tempo Médio de Resposta,
// Taxa de Engajamento por volume de mensagens) num score 0-100 por lead.
// Calculado em tempo real (sem tabela de score persistida) porque os
// componentes 2 e 3 dependem de chat_messages, que retém só 15 dias — uma
// tabela persistida ficaria presa em valores antigos assim que essa janela
// avançasse. Ver CLAUDE.md para a arquitetura completa e as limitações aceitas.

const CHAT_RETENTION_DAYS = 15;

function scoreFirstResponse(minutes) {
  if (minutes == null) return 0;
  if (minutes <= 5) return 100;
  if (minutes <= 15) return 80;
  if (minutes <= 30) return 60;
  if (minutes <= 60) return 40;
  return 10;
}

function scoreAvgResponse(minutes) {
  if (minutes == null) return null;
  if (minutes <= 5) return 100;
  if (minutes <= 15) return 85;
  if (minutes <= 30) return 65;
  if (minutes <= 60) return 40;
  return 15;
}

function scoreEngagementVolume(count, tiers) {
  if (count == null) return null;
  const tier = (tiers || []).find(t => count >= t.min && (t.max == null || count <= t.max));
  return tier ? tier.score : null;
}

/** Combina os componentes disponíveis, redistribuindo peso dos que faltam dado. */
function combinarIndice(componentes, pesos) {
  const disponiveis = componentes.filter(c => c.score != null);
  if (!disponiveis.length) return { indice: null, componentesUsados: 0 };
  const pesoTotalDisponivel = disponiveis.reduce((sum, c) => sum + pesos[c.chave], 0);
  if (pesoTotalDisponivel <= 0) return { indice: null, componentesUsados: 0 };
  const indice = disponiveis.reduce(
    (sum, c) => sum + c.score * (pesos[c.chave] / pesoTotalDisponivel),
    0
  );
  return { indice: Math.round(indice), componentesUsados: disponiveis.length };
}

/** Calcula os 3 componentes para 1 lead (telefone+instância+cliente). */
async function calcularParaLead(pool, { cliente_id, telefone, instancia, created_at, first_response_at, settings }) {
  const businessHoursConfig = settings.business_hours_enabled ? settings : null;

  // Mensagens do par dentro da janela de retenção (usadas nos componentes 2 e 3).
  const msgsRes = await pool.query(
    `SELECT from_me, is_bot_reply, message_at
     FROM chat_messages
     WHERE cliente_id = $1 AND telefone = $2 AND instance = $3
       AND message_at >= NOW() - INTERVAL '${CHAT_RETENTION_DAYS} days'
     ORDER BY message_at ASC`,
    [cliente_id, telefone, instancia]
  );
  const msgs = msgsRes.rows;
  const temDadoNaJanela = msgs.length > 0;

  // ── Componente 1: Primeira Resposta (humana) ──
  let firstResponseMinutes = null;
  let firstResponseFonte = 'sem_dado';
  if (temDadoNaJanela) {
    const primeiraDoLead = msgs.find(m => !m.from_me);
    const primeiraHumana = msgs.find(m => m.from_me && !m.is_bot_reply);
    if (primeiraDoLead && primeiraHumana && new Date(primeiraHumana.message_at) >= new Date(primeiraDoLead.message_at)) {
      firstResponseMinutes = businessHoursConfig
        ? calcBusinessMinutes(primeiraDoLead.message_at, primeiraHumana.message_at, businessHoursConfig)
        : (new Date(primeiraHumana.message_at) - new Date(primeiraDoLead.message_at)) / 60000;
      firstResponseFonte = 'chat_messages';
    }
  }
  if (firstResponseFonte === 'sem_dado' && created_at) {
    // Fallback fora da janela: first_response_at legado, sem filtro anti-bot (limitação aceita).
    if (first_response_at) {
      firstResponseMinutes = businessHoursConfig
        ? calcBusinessMinutes(created_at, first_response_at, businessHoursConfig)
        : (new Date(first_response_at) - new Date(created_at)) / 60000;
      firstResponseFonte = 'first_response_at_legado';
    } else {
      firstResponseFonte = 'sem_resposta';
    }
  }

  // ── Componente 2: Tempo Médio (mediana) de Resposta ──
  // Pareia cada mensagem do lead com a próxima resposta humana subsequente.
  let deltasMinutos = [];
  if (temDadoNaJanela) {
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].from_me) continue;
      const proximaHumana = msgs.slice(i + 1).find(m => m.from_me && !m.is_bot_reply);
      if (proximaHumana) {
        const delta = businessHoursConfig
          ? calcBusinessMinutes(msgs[i].message_at, proximaHumana.message_at, businessHoursConfig)
          : (new Date(proximaHumana.message_at) - new Date(msgs[i].message_at)) / 60000;
        deltasMinutos.push(delta);
      }
    }
  }
  let avgResponseMinutes = null;
  let medianResponseMinutes = null;
  if (deltasMinutos.length) {
    avgResponseMinutes = deltasMinutos.reduce((a, b) => a + b, 0) / deltasMinutos.length;
    const sorted = [...deltasMinutos].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianResponseMinutes = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // ── Componente 3: Taxa de Engajamento (volume bruto de mensagens) ──
  const volumeMensagens = temDadoNaJanela ? msgs.length : null;

  const componentes = [
    { chave: 'first_response', score: temDadoNaJanela || first_response_at ? scoreFirstResponse(firstResponseMinutes) : null },
    { chave: 'avg_response', score: scoreAvgResponse(medianResponseMinutes) },
    { chave: 'engagement_rate', score: scoreEngagementVolume(volumeMensagens, settings.engagement_volume_tiers) },
  ];
  const pesos = {
    first_response: settings.weight_first_response,
    avg_response: settings.weight_avg_response,
    engagement_rate: settings.weight_engagement_rate,
  };
  const { indice, componentesUsados } = combinarIndice(componentes, pesos);

  return {
    indice,
    componentesUsados,
    totalComponentes: 3,
    detalhe: {
      first_response: { minutos: firstResponseMinutes != null ? Math.round(firstResponseMinutes) : null, score: componentes[0].score, fonte: firstResponseFonte },
      avg_response: { media_minutos: avgResponseMinutes != null ? Math.round(avgResponseMinutes) : null, mediana_minutos: medianResponseMinutes != null ? Math.round(medianResponseMinutes) : null, score: componentes[1].score, amostras: deltasMinutos.length },
      engagement_rate: { volume_mensagens: volumeMensagens, score: componentes[2].score },
    },
  };
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (requirePermission(user, res, 'leads')) return;

  try {
    await ensureChatMessagesSchema();
    const pool = getPool();

    if (req.query.lead_id) {
      const leadRes = await pool.query(
        `SELECT id, cliente_id, telefone, instancia, created_at, first_response_at
         FROM leads_tracking WHERE id = $1`,
        [req.query.lead_id]
      );
      const lead = leadRes.rows[0];
      if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
      if (!user.is_admin && lead.cliente_id !== user.cliente_id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const settings = await getEngagementSettings(lead.cliente_id);
      const resultado = await calcularParaLead(pool, {
        cliente_id: lead.cliente_id,
        telefone: lead.telefone,
        instancia: lead.instancia,
        created_at: lead.created_at,
        first_response_at: lead.first_response_at,
        settings,
      });
      return res.status(200).json(resultado);
    }

    return res.status(400).json({ error: 'Informe lead_id.' });
  } catch (err) {
    console.error('[engagement-metrics]', err.message);
    return res.status(500).json({ error: 'Erro ao calcular índice de engajamento.' });
  }
}
