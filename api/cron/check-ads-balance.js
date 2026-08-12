// Alerta de saldo baixo na conta de anúncios Meta — checa a cada 6h (ver
// server.js) todos os clientes com `account_id` E `saldo_alerta_minimo`
// configurados (aba Meta Ads do modal Editar Cliente), compara com
// `balance` da Graph API e dispara WhatsApp para o admin quando estiver
// abaixo do limite. Mesmo padrão de token/envio já usado em
// api/cron/send-reports.js — reaproveitado, não recriado.
import { getPool } from '../_db.js';
import { fetchMeta } from '../_meta-client.js';
import { decryptToken } from '../_crypto.js';

// Destino fixo do admin (não por cliente — decisão do usuário: um único
// número/grupo recebe todos os alertas de saldo de todos os clientes).
// Preencher no .env do EasyPanel; sem eles, o cron não envia nada (mas
// continua rodando/logando, sem quebrar o resto do servidor).
const ALERTA_INSTANCE = process.env.ALERTA_SALDO_INSTANCE;
const ALERTA_DESTINO  = process.env.ALERTA_SALDO_DESTINO; // número (5511...) ou JID de grupo (...@g.us)

function formatEvolutionNumber(jid) {
  const value = String(jid || '').trim();
  if (value.endsWith('@g.us')) return value;
  return value.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
}

function formatMoeda(valorMinorUnit, currency) {
  const valor = (Number(valorMinorUnit) || 0) / 100;
  try {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: currency || 'BRL' });
  } catch {
    return `${currency || 'R$'} ${valor.toFixed(2)}`;
  }
}

export async function runCheckAdsBalance() {
  const pool = getPool();

  // Migração lazy da própria checagem — evita depender só de
  // ensureTrackingSchema() ter rodado antes deste cron específico.
  await pool.query(`
    ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS saldo_alerta_minimo NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS saldo_alerta_disparado_em TIMESTAMP
  `).catch(() => {});

  if (!ALERTA_INSTANCE || !ALERTA_DESTINO) {
    console.warn('[CheckAdsBalance] ALERTA_SALDO_INSTANCE/ALERTA_SALDO_DESTINO não configurados — pulando checagem.');
    return;
  }

  const EVO_URL = process.env.EVOLUTION_API_URL;
  const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
  if (!EVO_URL || !EVO_KEY) {
    console.warn('[CheckAdsBalance] EVOLUTION_API_URL/EVOLUTION_GLOBAL_KEY não configurados — pulando checagem.');
    return;
  }

  const { rows: clientes } = await pool.query(`
    SELECT id, nome, account_id, token_meta, token_meta_enc, saldo_alerta_minimo, saldo_alerta_disparado_em
    FROM clientes
    WHERE archived_at IS NULL
      AND account_id IS NOT NULL AND account_id <> ''
      AND saldo_alerta_minimo IS NOT NULL AND saldo_alerta_minimo > 0
  `);

  if (!clientes.length) return;

  let checados = 0, alertados = 0;

  for (const cli of clientes) {
    try {
      let token = null;
      if (cli.token_meta_enc) {
        try { token = decryptToken(cli.token_meta_enc); }
        catch (e) { console.error(`[CheckAdsBalance] Falha ao descriptografar token do cliente #${cli.id}:`, e.message); }
      }
      token = token || cli.token_meta || process.env.META_ADS_TOKEN;
      if (!token) { console.warn(`[CheckAdsBalance] Cliente #${cli.id} sem token disponível — pulando.`); continue; }

      const accountId = String(cli.account_id).replace(/^act_/, '');
      const url = `https://graph.facebook.com/v20.0/act_${accountId}?fields=name,balance,currency&access_token=${token}`;
      const r = await fetchMeta(url);
      const data = await r.json();
      checados++;

      if (data.error) {
        console.warn(`[CheckAdsBalance] Cliente #${cli.id} (${cli.nome}): erro Meta — ${data.error.message}`);
        continue;
      }

      // balance vem em minor unit (centavos); saldo_alerta_minimo é gravado
      // em reais (NUMERIC comum) — mesma unidade que o admin digita no painel.
      const saldoReais = (Number(data.balance) || 0) / 100;
      const abaixoDoLimite = saldoReais < Number(cli.saldo_alerta_minimo);

      if (!abaixoDoLimite) {
        // Saldo recuperou: zera o controle de anti-spam pra poder alertar
        // de novo se cair abaixo do limite outra vez no futuro.
        if (cli.saldo_alerta_disparado_em) {
          await pool.query('UPDATE clientes SET saldo_alerta_disparado_em = NULL WHERE id = $1', [cli.id]);
        }
        continue;
      }

      // Anti-spam: só 1 alerta a cada 24h por cliente, mesmo rodando a cada 6h.
      const jaAlertadoHoje = cli.saldo_alerta_disparado_em &&
        (Date.now() - new Date(cli.saldo_alerta_disparado_em).getTime()) < 24 * 60 * 60 * 1000;
      if (jaAlertadoHoje) continue;

      const msg = `⚠️ *Saldo baixo de anúncios*\n\n`
        + `*Cliente:* ${cli.nome}\n`
        + `*Conta:* ${data.name || `act_${accountId}`}\n`
        + `*Saldo atual:* ${formatMoeda(data.balance, data.currency)}\n`
        + `*Limite configurado:* ${formatMoeda(Number(cli.saldo_alerta_minimo) * 100, data.currency)}\n\n`
        + `🤖 _Alerta automático — Adlytics Pro._`;

      const evoNumber = formatEvolutionNumber(ALERTA_DESTINO);
      const evoRes = await fetch(`${EVO_URL}/message/sendText/${ALERTA_INSTANCE}`, {
        method: 'POST',
        headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: evoNumber, text: msg }),
      });

      if (evoRes.ok) {
        alertados++;
        await pool.query('UPDATE clientes SET saldo_alerta_disparado_em = NOW() WHERE id = $1', [cli.id]);
        console.log(`[CheckAdsBalance] ✅ Alerta enviado — cliente #${cli.id} (${cli.nome}), saldo ${formatMoeda(data.balance, data.currency)}`);
      } else {
        console.error(`[CheckAdsBalance] Falha ao enviar WhatsApp para cliente #${cli.id}: Evolution ${evoRes.status}`);
      }
    } catch (e) {
      console.error(`[CheckAdsBalance] Erro ao processar cliente #${cli.id}:`, e.message);
    }
  }

  console.log(`[CheckAdsBalance] Checagem concluída: ${checados} conta(s) verificada(s), ${alertados} alerta(s) enviado(s).`);
}
