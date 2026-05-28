import { getPool } from '../_db.js';
import { fetchMeta } from '../_meta-client.js';
import crypto from 'crypto';

const decryptToken = (encryptedHex) => {
    try {
        if (!encryptedHex) return null;
        const keyBuffer = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
        const data = Buffer.from(encryptedHex, 'hex');
        const iv = data.slice(0, 16);
        const authTag = data.slice(data.length - 16);
        const encryptedText = data.slice(16, data.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) {
        console.error('Falha ao descriptografar token:', e);
        return null;
    }
};

export default async function handler(req, res) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    console.log('[Cron] Iniciando envio de relatórios Zap...', new Date().toISOString());
    const pool = getPool();

    const now = new Date();
    const horarioAtual = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    }).format(now);
    const agoraSp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const diaSemana = agoraSp.getDay();
    const diaDoMes  = agoraSp.getDate();
    const hojeChave = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    const toleranciaMin = Math.max(0, parseInt(process.env.ZAP_CRON_TOLERANCE_MINUTES || '10', 10));
    const minutosAgora = hhmmToMinutes(horarioAtual);

    try {
        await pool.query(`
            ALTER TABLE zap_agendamentos
            ADD COLUMN IF NOT EXISTS ultimo_envio_chave VARCHAR(32),
            ADD COLUMN IF NOT EXISTS ultimo_envio_em TIMESTAMPTZ
        `);

        const { rows: agendamentos } = await pool.query(`
            SELECT z.*, c.token_meta, c.token_meta_enc,
                   c.account_id AS cliente_account_id
            FROM zap_agendamentos z
            LEFT JOIN clientes c ON c.id = z.cliente_id
            WHERE z.status = 'ativo'
        `);

        let enviados = 0;
        let elegiveis = 0;

        for (const ag of agendamentos) {
            // Filtro de frequência
            if (ag.frequencia === 'semanal' && diaSemana !== 1) continue;
            if (ag.frequencia === 'mensal'  && diaDoMes  !== 1) continue;

            // Filtro de horário — aceita pequena janela para cron externo que roda atrasado.
            const horaAgendada = String(ag.horario || '').substring(0, 5);
            const minutosAgendado = hhmmToMinutes(horaAgendada);
            const atrasoMin = minutosAgora - minutosAgendado;
            if (!Number.isFinite(minutosAgendado) || atrasoMin < 0 || atrasoMin > toleranciaMin) continue;

            const envioChave = `${hojeChave}:${horaAgendada}`;
            if (ag.ultimo_envio_chave === envioChave) continue;
            elegiveis++;

            console.log(`[Cron] Processando #${ag.id} → ${ag.destino_nome || ag.destino_jid} (${horaAgendada}, atraso ${atrasoMin}min)`);

            const token = ag.token_meta_enc
                ? decryptToken(ag.token_meta_enc.toString('hex'))
                : (ag.token_meta || process.env.META_ADS_TOKEN);

            const accountId = String(ag.account_id || ag.cliente_account_id || '').replace(/^act_/, '');

            if (!token || !accountId) {
                console.warn(`[Cron] #${ag.id} sem token ou account_id — pulando`);
                continue;
            }

            // Mapeamento de período para date_preset Meta
            const periodoMap = {
                yesterday:      'yesterday',
                last_7_days:    'last_7d',
                last_14_days:   'last_14d',
                last_30_days:   'last_30d',
                current_month:  'this_month',
                previous_month: 'last_month',
            };
            const datePreset = periodoMap[ag.periodo] || 'yesterday';

            // Busca campanhas na Meta API
            const insightFields = 'spend,impressions,clicks,reach,cpm,cpc,ctr,actions,purchase_roas';
            const fields = `name,status,insights.date_preset(${datePreset}){${insightFields}}`;
            let url = `https://graph.facebook.com/v20.0/act_${accountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;

            let allCampaigns = [];
            try {
                while (url) {
                    const r = await fetchMeta(url);
                    const data = await r.json();
                    if (data.error) throw new Error(data.error.message);
                    if (data.data) allCampaigns.push(...data.data);
                    url = data.paging?.next || null;
                }
            } catch (e) {
                console.error(`[Cron] Erro Meta Ads #${ag.id}:`, e.message);
                continue;
            }

            // Agrega métricas
            let totalSpend = 0, totalImps = 0, totalClicks = 0, totalLeads = 0,
                totalMsgs = 0, totalReach = 0, totalRoasValue = 0;

            for (const c of allCampaigns) {
                const ins = c.insights?.data?.[0];
                if (!ins) continue;
                totalSpend  += parseFloat(ins.spend       || 0);
                totalImps   += parseInt(ins.impressions   || 0);
                totalClicks += parseInt(ins.clicks        || 0);
                totalReach  += parseInt(ins.reach         || 0);
                for (const a of (ins.actions || [])) {
                    if (a.action_type === 'lead') totalLeads += parseInt(a.value || 0);
                    if (a.action_type === 'onsite_conversion.messaging_conversation_started_7d')
                        totalMsgs += parseInt(a.value || 0);
                }
                for (const r of (ins.purchase_roas || [])) {
                    if (r.action_type === 'omni_purchase') totalRoasValue += parseFloat(r.value || 0);
                }
            }

            const fmtBrl = v => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(v);
            const fmtNum = v => new Intl.NumberFormat('pt-BR').format(v);

            const cpl  = totalLeads  > 0 ? totalSpend / totalLeads  : 0;
            const cpr  = totalMsgs   > 0 ? totalSpend / totalMsgs   : 0;
            const cpc  = totalClicks > 0 ? totalSpend / totalClicks : 0;
            const cpm  = totalImps   > 0 ? (totalSpend / totalImps) * 1000 : 0;
            const ctr  = totalImps   > 0 ? (totalClicks / totalImps) * 100 : 0;
            const roas = totalSpend  > 0 ? totalRoasValue / totalSpend : 0;

            const periodoLabels = {
                yesterday: 'Ontem', last_7_days: 'Últimos 7 dias',
                last_14_days: 'Últimos 14 dias', last_30_days: 'Últimos 30 dias',
                current_month: 'Este mês', previous_month: 'Mês anterior',
            };
            const periodoLabel = periodoLabels[ag.periodo] || 'Ontem';

            // Monta mensagem
            let msg = (ag.template || '').trim();

            if (msg) {
                msg = msg
                    .replace(/{periodo}/gi,    periodoLabel)
                    .replace(/{gasto}/gi,      fmtBrl(totalSpend))
                    .replace(/{leads}/gi,      fmtNum(totalLeads))
                    .replace(/{cpl}/gi,        fmtBrl(cpl))
                    .replace(/{msgs}/gi,       fmtNum(totalMsgs))
                    .replace(/{cpr}/gi,        fmtBrl(cpr))
                    .replace(/{cliques}/gi,    fmtNum(totalClicks))
                    .replace(/{ctr}/gi,        ctr.toFixed(2) + '%')
                    .replace(/{roas}/gi,       roas.toFixed(2) + 'x')
                    .replace(/{cpc}/gi,        fmtBrl(cpc))
                    .replace(/{cpm}/gi,        fmtBrl(cpm))
                    .replace(/{alcance}/gi,    fmtNum(totalReach))
                    .replace(/{impressoes}/gi, fmtNum(totalImps));
            } else {
                msg = `📊 *Resumo — ${periodoLabel}*\n\n`
                    + `💰 *Gasto:* ${fmtBrl(totalSpend)}\n`
                    + `🎯 *Leads:* ${fmtNum(totalLeads)}\n`
                    + `💬 *Mensagens:* ${fmtNum(totalMsgs)}\n`
                    + `📉 *CPL:* ${fmtBrl(cpl)}\n`
                    + `📈 *ROAS:* ${roas.toFixed(2)}x\n\n`
                    + `🤖 _Enviado via automação._`;
            }

            // Dispara via Evolution API
            const EVO_URL = process.env.EVOLUTION_API_URL;
            const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
            if (!EVO_URL || !EVO_KEY) {
                console.warn('[Cron] EVOLUTION_API_URL/KEY não configurados');
                continue;
            }

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
                        `UPDATE zap_agendamentos
                         SET ultimo_envio_chave = $1, ultimo_envio_em = NOW()
                         WHERE id = $2`,
                        [envioChave, ag.id]
                    );
                    console.log(`[Cron] ✅ Enviado para ${evoNumber}`);
                } else {
                    const errText = await evoRes.text();
                    console.error(`[Cron] Evolution ${evoRes.status}: ${errText.slice(0, 200)}`);
                }
            } catch (e) {
                console.error(`[Cron] Falha ao enviar #${ag.id}:`, e.message);
            }
        }

        return res.status(200).json({ success: true, enviados, elegiveis, total: agendamentos.length, horarioAtual, toleranciaMin });

    } catch (err) {
        console.error('[Cron Error]', err);
        return res.status(500).json({ error: err.message });
    }
}

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
