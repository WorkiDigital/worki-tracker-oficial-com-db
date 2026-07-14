import { getPool } from '../_db.js';
import { fetchMeta } from '../_meta-client.js';
import { decryptToken } from '../_crypto.js';
import { normalizeCampaignFilters, summarizeZapCampaigns } from '../_zap-report-metrics.js';

function hhmmToMinutes(value) {
    const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
}

function formatEvolutionNumber(jid, tipo) {
    const value = String(jid || '').trim();
    if (tipo === 'grupo' || value.endsWith('@g.us')) return value;
    return value.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
}

export async function runCronJob() {
    const pool = getPool();
    const now = new Date();

    const horarioAtual = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    }).format(now);
    const agoraSp   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const diaSemana = agoraSp.getDay();
    const diaDoMes  = agoraSp.getDate();
    const hojeChave = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    const toleranciaMin = Math.max(0, parseInt(process.env.ZAP_CRON_TOLERANCE_MINUTES || '2', 10));
    const minutosAgora  = hhmmToMinutes(horarioAtual);

    // Garante colunas/tabelas (migrações automáticas)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.zap_destinos (
            id            SERIAL PRIMARY KEY,
            cliente_id    INTEGER REFERENCES public.clientes(id) ON DELETE CASCADE,
            nome          VARCHAR(255) NOT NULL,
            account_id    VARCHAR(255),
            instance_name VARCHAR(255) NOT NULL,
            destino_tipo  VARCHAR(20)  DEFAULT 'grupo',
            destino_jid   VARCHAR(255) NOT NULL,
            destino_nome  VARCHAR(255),
            criado_em     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
        );
        ALTER TABLE zap_agendamentos
        ADD COLUMN IF NOT EXISTS account_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS campaign_filter_text TEXT,
        ADD COLUMN IF NOT EXISTS campaign_objectives TEXT[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS ultimo_envio_chave VARCHAR(32),
        ADD COLUMN IF NOT EXISTS ultimo_envio_em TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS destino_id INTEGER REFERENCES public.zap_destinos(id) ON DELETE CASCADE;
        ALTER TABLE zap_agendamentos
        ALTER COLUMN instance_name DROP NOT NULL,
        ALTER COLUMN destino_jid DROP NOT NULL
    `).catch(() => {});

    // JOIN com zap_destinos (nível 1: conta/instância/destino fixos) — zap_agendamentos
    // agora é o "relatório" (nível 2: filtro/mensagem/frequência). Linhas legadas ainda
    // sem destino_id (pré-migração) caem no LEFT JOIN com d.* nulo e são puladas abaixo
    // por falta de instance_name/destino_jid resolvidos.
    const { rows: agendamentos } = await pool.query(`
        SELECT r.*,
               d.instance_name, d.destino_tipo, d.destino_jid, d.destino_nome,
               d.account_id AS destino_account_id,
               c.token_meta, c.token_meta_enc,
               c.account_id AS cliente_account_id
        FROM zap_agendamentos r
        LEFT JOIN zap_destinos d ON d.id = r.destino_id
        LEFT JOIN clientes c ON c.id = r.cliente_id
        WHERE r.status = 'ativo'
    `);

    let enviados = 0, elegiveis = 0;

    for (const ag of agendamentos) {
        if (!ag.instance_name || !ag.destino_jid) {
            console.warn(`[CronZap] #${ag.id} sem destino vinculado (destino_id ausente) — pulando`);
            continue;
        }
        if (ag.frequencia === 'semanal' && diaSemana !== 1) continue;
        if (ag.frequencia === 'mensal'  && diaDoMes  !== 1) continue;

        const horaAgendada    = String(ag.horario || '').substring(0, 5);
        const minutosAgendado = hhmmToMinutes(horaAgendada);
        const atrasoMin       = minutosAgora - minutosAgendado;
        if (!Number.isFinite(minutosAgendado) || atrasoMin < 0 || atrasoMin > toleranciaMin) continue;

        const envioChave = `${hojeChave}:${horaAgendada}`;
        if (ag.ultimo_envio_chave === envioChave) continue;

        // Lock por agendamento: evita envio duplicado se duas execuções do cron
        // rodarem ao mesmo tempo (ex: reinício do processo no meio do tick, ou
        // futura escala horizontal). pg_try_advisory_lock não bloqueia — se outra
        // instância já detém o lock, esta pula o agendamento sem esperar.
        const lockKey = `zap_report_${ag.id}`;
        const lockRes = await pool.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
        if (!lockRes.rows[0]?.ok) {
            console.warn(`[CronZap] #${ag.id} já está sendo processado por outra execução — pulando`);
            continue;
        }

        try {
        elegiveis++;

        console.log(`[CronZap] #${ag.id} → ${ag.destino_nome || ag.destino_jid} (${horaAgendada})`);

        let token = ag.token_meta || process.env.META_ADS_TOKEN;
        if (ag.token_meta_enc) {
            try { token = decryptToken(ag.token_meta_enc); } catch (e) { console.error(`[CronZap] Erro ao descriptografar token #${ag.id}:`, e.message); }
        }
        const accountId = String(ag.destino_account_id || ag.cliente_account_id || '').replace(/^act_/, '');

        if (!token || !accountId) {
            console.warn(`[CronZap] #${ag.id} sem token ou account_id — pulando`);
            continue;
        }

        const periodoMap = {
            yesterday: 'yesterday', last_7_days: 'last_7d', last_14_days: 'last_14d',
            last_30_days: 'last_30d', current_month: 'this_month', previous_month: 'last_month',
        };
        const datePreset    = periodoMap[ag.periodo] || 'yesterday';
        const insightFields = 'spend,impressions,clicks,reach,actions,purchase_roas';
        const fields        = `name,status,objective,insights.date_preset(${datePreset}){${insightFields}}`;
        let url = `https://graph.facebook.com/v20.0/act_${accountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;

        let allCampaigns = [];
        try {
            while (url) {
                const r    = await fetchMeta(url);
                const data = await r.json();
                if (data.error) throw new Error(data.error.message);
                if (data.data) allCampaigns.push(...data.data);
                url = data.paging?.next || null;
            }
        } catch (e) {
            console.error(`[CronZap] Meta Ads #${ag.id}: ${e.message}`);
            continue;
        }
        const filters = normalizeCampaignFilters({
            campaign_filter_text: ag.campaign_filter_text,
            campaign_objectives: ag.campaign_objectives,
        });
        const totals = summarizeZapCampaigns(allCampaigns, filters);
        const totalSpend = totals.spend;
        const totalImps = totals.impressions;
        const totalClicks = totals.clicks;
        const totalLeads = totals.leads;
        const totalMsgs = totals.msgs;
        const totalReach = totals.reach;
        const totalRoas = totals.roas;

        const fmtBrl = v => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(v);
        // fmtVal: valor monetário SEM prefixo R$ (para templates onde o usuário já escreveu "R$ {gasto}")
        const fmtVal = v => new Intl.NumberFormat('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(v || 0);
        const fmtNum = v => new Intl.NumberFormat('pt-BR').format(v);

        const cpl  = totalLeads  > 0 ? totalSpend / totalLeads  : 0;
        const cpr  = totalMsgs   > 0 ? totalSpend / totalMsgs   : 0;
        const cpc  = totalClicks > 0 ? totalSpend / totalClicks : 0;
        const cpm  = totalImps   > 0 ? (totalSpend / totalImps) * 1000 : 0;
        const ctr  = totalImps   > 0 ? (totalClicks / totalImps) * 100  : 0;
        const roas = totalRoas;

        const periodoLabels = {
            yesterday: 'Ontem', last_7_days: 'Últimos 7 dias',
            last_14_days: 'Últimos 14 dias', last_30_days: 'Últimos 30 dias',
            current_month: 'Este mês', previous_month: 'Mês anterior',
        };
        const periodoLabel = periodoLabels[ag.periodo] || 'Ontem';

        // Datas do período
        const fmtDate = d => d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
        const hojeD   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const ontemD  = new Date(hojeD.getFullYear(), hojeD.getMonth(), hojeD.getDate() - 1);
        const periodoDataMap = {
            yesterday:      [ontemD, ontemD],
            last_7_days:    [new Date(hojeD.getFullYear(), hojeD.getMonth(), hojeD.getDate() - 7), ontemD],
            last_14_days:   [new Date(hojeD.getFullYear(), hojeD.getMonth(), hojeD.getDate() - 14), ontemD],
            last_30_days:   [new Date(hojeD.getFullYear(), hojeD.getMonth(), hojeD.getDate() - 30), ontemD],
            current_month:  [new Date(hojeD.getFullYear(), hojeD.getMonth(), 1), ontemD],
            previous_month: [new Date(hojeD.getFullYear(), hojeD.getMonth() - 1, 1), new Date(hojeD.getFullYear(), hojeD.getMonth(), 0)],
        };
        const [dInicio, dFim] = periodoDataMap[ag.periodo] || [ontemD, ontemD];
        const dataInicio = fmtDate(dInicio);
        const dataFim    = fmtDate(dFim);

        let msg = (ag.template || '').trim();
        if (msg) {
            msg = msg
                .replace(/{periodo}/gi,     periodoLabel)
                .replace(/{data_inicio}/gi, dataInicio)
                .replace(/{data_fim}/gi,    dataFim)
                .replace(/{gasto}/gi,       fmtVal(totalSpend))
                .replace(/{leads}/gi,       fmtNum(totalLeads))
                .replace(/{cpl}/gi,         fmtVal(cpl))
                .replace(/{msgs}/gi,        fmtNum(totalMsgs))
                .replace(/{cpr}/gi,         fmtVal(cpr))
                .replace(/{cliques}/gi,     fmtNum(totalClicks))
                .replace(/{ctr}/gi,         ctr.toFixed(2))
                .replace(/{roas}/gi,        roas.toFixed(2))
                .replace(/{cpc}/gi,         fmtVal(cpc))
                .replace(/{cpm}/gi,         fmtVal(cpm))
                .replace(/{alcance}/gi,     fmtNum(totalReach))
                .replace(/{impressoes}/gi,  fmtNum(totalImps));
        } else {
            msg = `📊 *Resumo — ${periodoLabel}*\n\n`
                + `💰 *Gasto:* ${fmtBrl(totalSpend)}\n`
                + `🎯 *Leads:* ${fmtNum(totalLeads)}\n`
                + `💬 *Mensagens:* ${fmtNum(totalMsgs)}\n`
                + `📉 *CPL:* ${fmtBrl(cpl)}\n`
                + `📈 *ROAS:* ${roas.toFixed(2)}x\n\n`
                + `🤖 _Enviado via automação._`;
        }

        const EVO_URL = process.env.EVOLUTION_API_URL;
        const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
        if (!EVO_URL || !EVO_KEY) { console.warn('[CronZap] EVO env não configurada'); continue; }

        try {
            const evoNumber = formatEvolutionNumber(ag.destino_jid, ag.destino_tipo);
            const evoRes = await fetch(`${EVO_URL}/message/sendText/${ag.instance_name}`, {
                method: 'POST',
                headers: { 'apikey': EVO_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: evoNumber, text: msg })
            });
            if (evoRes.ok) {
                enviados++;
                await pool.query(
                    `UPDATE zap_agendamentos SET ultimo_envio_chave=$1, ultimo_envio_em=NOW() WHERE id=$2`,
                    [envioChave, ag.id]
                );
                console.log(`[CronZap] ✅ Enviado para ${evoNumber}`);
            } else {
                console.error(`[CronZap] Evolution ${evoRes.status}: ${(await evoRes.text()).slice(0, 200)}`);
            }
        } catch (e) {
            console.error(`[CronZap] Falha #${ag.id}: ${e.message}`);
        }
        } finally {
            await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => {});
        }
    }

    return { success: true, enviados, elegiveis, total: agendamentos.length, horarioAtual };
}

export default async function handler(req, res) {
    const cronSecret = process.env.CRON_SECRET;
    // Fail-closed: em produção, CRON_SECRET é obrigatório — sem ele a rota
    // ficaria aberta para qualquer requisição sem autenticação nenhuma.
    if (!cronSecret) {
        if (process.env.NODE_ENV === 'production') {
            return res.status(500).json({ error: 'CRON_SECRET não configurado no servidor.' });
        }
    } else if (req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    try {
        const result = await runCronJob();
        return res.status(200).json(result);
    } catch (err) {
        console.error('[CronZap HTTP]', err);
        return res.status(500).json({ error: err.message });
    }
}
