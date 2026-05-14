import { getPool } from '../_db.js';
import { fetchMeta } from '../_meta-client.js';
import crypto from 'crypto';

// Descriptografar token se necessário (similar a _auth.js)
const decryptToken = (encryptedHex) => {
    try {
      if(!encryptedHex) return null;
      const ENC_KEY = process.env.TOKEN_ENCRYPTION_KEY;
      const keyBuffer = Buffer.from(ENC_KEY, 'hex');
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
    // Validação básica de segurança para endpoints cron
    // Permite chamadas locais ou com uma chave secreta (CRON_SECRET)
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    console.log('[Cron] Iniciando rotina de envio de relatórios...', new Date().toISOString());
    const pool = getPool();
    
    // Calcula o horário atual (HH:MM) no fuso de Brasília (ou do servidor)
    const now = new Date();
    // Exemplo simplificado: Pega HH:MM atual (ajustar fuso se necessário)
    // Usaremos pt-BR UTC-3
    const options = { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' };
    const horarioAtual = new Intl.DateTimeFormat('pt-BR', options).format(now);
    
    // Qual dia da semana é hoje? (para filtro de relatórios semanais)
    // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
    const diaSemana = now.getDay();
    
    try {
        // Busca relatórios ativos cujo horário coincida (ex: '08:00' e atual é '08:00' a '08:05' dependendo da precisão do cron)
        // Para garantir que o cron possa rodar a cada hora ou X minutos, faremos um LIKE simples só na hora (HH:00) ou matching exato
        // Assumindo que o cron rode no minuto exato configurado, ou faremos uma busca ampla
        
        // Vamos pegar todos ativos para simplificar a lógica inicial (num app real filtramos por hora no SQL)
        const reportsRes = await pool.query('SELECT * FROM relatorios_agendados WHERE status = true');
        const relatorios = reportsRes.rows;

        let enviados = 0;

        for (const rel of relatorios) {
            // Verifica o dia da semana se for semanal
            if (rel.frequencia === 'semanal' && diaSemana !== 1) { // Só envia segunda-feira
                continue;
            }

            // Verifica o horário (matching de hora)
            // Se o horário agendado for '08:00' e agora for '08:01', enviamos.
            const horaAgendada = rel.horario_envio.split(':')[0];
            const horaAtual = horarioAtual.split(':')[0];
            
            // Só envia se a hora bater e se já não enviamos hoje (idealmente teria uma tabela de histórico de disparos,
            // aqui simplificamos pela hora exata se o cron rodar de hora em hora).
            if (horaAgendada !== horaAtual) continue;

            console.log(`[Cron] Processando relatório para cliente ${rel.cliente_id} (Destino: ${rel.nome_destino})`);

            // 1. Busca dados do cliente (Token e Account ID)
            const clienteRes = await pool.query('SELECT token_meta, token_meta_enc, account_id FROM clientes WHERE id = $1', [rel.cliente_id]);
            if(clienteRes.rowCount === 0) continue;
            
            const cliente = clienteRes.rows[0];
            const token = cliente.token_meta_enc ? decryptToken(cliente.token_meta_enc.toString('hex')) : cliente.token_meta;
            const accountId = cliente.account_id;

            if(!token || !accountId) continue;

            // 2. Busca os dados no Meta Ads (Ontem por padrão, ou últimos 7 dias se semanal)
            const datePreset = rel.frequencia === 'semanal' ? 'last_7d' : 'yesterday';
            const insightFields = 'spend,impressions,clicks,outbound_clicks,ctr,reach,cpm,cpc,frequency,inline_link_clicks,actions,action_values,cost_per_action_type,purchase_roas,instagram_profile_visits';
            const fields = `name,status,objective,insights.date_preset(${datePreset}){${insightFields}}`;
            let url = `https://graph.facebook.com/v20.0/${accountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;
            
            let allCampaigns = [];
            try {
                while(url) {
                    const r = await fetchMeta(url);
                    const data = await r.json();
                    if(data.data) allCampaigns.push(...data.data);
                    url = data.paging?.next || null;
                }
            } catch(e) {
                console.error(`Falha ao buscar dados do cliente ${rel.cliente_id}:`, e.message);
                continue;
            }

            // 3. Calcula os totais
            let totalSpend = 0, totalImps = 0, totalClicks = 0, totalLeads = 0, totalConversas = 0;
            
            allCampaigns.forEach(c => {
                const ins = c.insights?.data?.[0];
                if(!ins) return;
                
                totalSpend += parseFloat(ins.spend || 0);
                totalImps += parseInt(ins.impressions || 0);
                totalClicks += parseInt(ins.clicks || 0);
                
                const actions = ins.actions || [];
                const leads = actions.find(a => a.action_type === 'lead');
                if (leads) totalLeads += parseInt(leads.value);
                
                const msgs = actions.find(a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d');
                if (msgs) totalConversas += parseInt(msgs.value);
            });

            // Formata o dinheiro
            const fmtBrl = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

            // 4. Monta a Mensagem do WhatsApp (Usa template se existir, senão usa o padrão)
            let metricas = [];
            try { metricas = typeof rel.metricas === 'string' ? JSON.parse(rel.metricas) : rel.metricas; } catch(e){}

            const roas = totalSpend > 0 ? (totalSpend / totalSpend) : 0; // Exemplo simplificado de ROAS
            const cpl = totalLeads > 0 ? (totalSpend / totalLeads) : 0;
            const cpr = totalConversas > 0 ? (totalSpend / totalConversas) : 0;
            const ctr = totalImps > 0 ? (totalClicks / totalImps) * 100 : 0;

            let msg = rel.mensagem_template;

            if (msg) {
                // Substituição dinâmica de variáveis no template
                msg = msg.replace(/{gasto}/gi, fmtBrl(totalSpend))
                         .replace(/{leads}/gi, totalLeads)
                         .replace(/{cpl}/gi, fmtBrl(cpl))
                         .replace(/{msgs}/gi, totalConversas)
                         .replace(/{cpr}/gi, fmtBrl(cpr))
                         .replace(/{cliques}/gi, totalClicks)
                         .replace(/{ctr}/gi, ctr.toFixed(2) + '%')
                         .replace(/{roas}/gi, roas.toFixed(2));
            } else {
                // Fallback: Mensagem Padrão se não houver template
                msg = `📊 *Resumo de Performance (${rel.frequencia === 'semanal' ? 'Últimos 7 dias' : 'Ontem'})*\n`;
                msg += `_Conta: ${accountId}_\n\n`;

                if(metricas.includes('spend')) msg += `💰 *Gasto Total:* ${fmtBrl(totalSpend)}\n`;
                if(metricas.includes('leads')) msg += `🎯 *Leads Gerados:* ${totalLeads}\n`;
                if(metricas.includes('cpl'))   msg += `🏷️ *Custo p/ Lead (CPL):* ${fmtBrl(cpl)}\n`;
                if(metricas.includes('msgs'))  msg += `💬 *Conversas Iniciadas:* ${totalConversas}\n`;
                if(metricas.includes('cpr'))   msg += `🤝 *Custo p/ Conv. (CPR):* ${fmtBrl(cpr)}\n`;
                if(metricas.includes('clicks')) msg += `🖱️ *Cliques Totais:* ${totalClicks}\n`;
                
                msg += `\n🤖 _Enviado via automação._`;
            }

            // 5. Dispara para Evolution API
            const EVO_URL = process.env.EVOLUTION_API_URL;
            const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
            
            if(EVO_URL && EVO_KEY) {
                try {
                    await fetch(`${EVO_URL}/message/sendText/${rel.instance_name}`, {
                        method: 'POST',
                        headers: {
                            'apikey': EVO_KEY,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            number: rel.target_jid,
                            text: msg
                        })
                    });
                    enviados++;
                    console.log(`[Cron] Relatório enviado com sucesso para ${rel.target_jid}`);
                } catch(e) {
                    console.error(`[Cron] Falha ao enviar zap para ${rel.target_jid}:`, e.message);
                }
            }
        }

        return res.status(200).json({ success: true, message: `Rotina finalizada. ${enviados} relatórios enviados.` });

    } catch(err) {
        console.error('[Cron Error]', err);
        return res.status(500).json({ error: err.message });
    }
}
