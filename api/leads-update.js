import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';
import { enviarConversao } from './_capi.js';

// Envio CAPI (Purchase/QualifiedLead) centralizado em api/_capi.js — page_id,
// hashing, canal e dedup por event_id vivem lá. Este endpoint só atualiza o lead
// e delega a conversão ao módulo central (mesmo caminho do disparo automático).

export default async function handler(req, res) {
  if (cors(req, res, ['PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const { id, status, valor_venda, produto, nome, email, cpf, cidade, estado, endereco } = req.body;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  try {
    const pool = getPool();

    // Lista de updates dinâmicos
    const setClauses = [];
    const values = [];
    let queryIndex = 1;

    if (status) { 
      setClauses.push(`status = $${queryIndex++}`); 
      values.push(status); 
      if (status === 'Vendido' || status === 'Venda') {
        setClauses.push(`sale_closed_at = NOW()`);
      } else if (status === 'Qualificado') {
        setClauses.push(`qualified_at = NOW()`);
      }
    }
    if (valor_venda !== undefined){ setClauses.push(`valor_venda = $${queryIndex++}`);     values.push(valor_venda); }
    if (produto)                 { setClauses.push(`produto = $${queryIndex++}`);          values.push(produto); }
    if (nome)                    { setClauses.push(`nome = $${queryIndex++}`);             values.push(nome); }
    if (email)                   { setClauses.push(`email = $${queryIndex++}`);            values.push(email); }
    if (cpf)                     { setClauses.push(`cpf = $${queryIndex++}`);              values.push(cpf); }
    if (cidade)                  { setClauses.push(`cidade = $${queryIndex++}`);           values.push(cidade); }
    if (estado)                  { setClauses.push(`estado = $${queryIndex++}`);           values.push(estado); }
    if (endereco)                { setClauses.push(`endereco = $${queryIndex++}`);         values.push(endereco); }

    if (setClauses.length > 0) {
      values.push(id);
      
      let updateQuery;
      if (user.is_admin) {
        updateQuery = `UPDATE leads_tracking SET ${setClauses.join(', ')} WHERE id = $${queryIndex} RETURNING *`;
      } else {
        values.push(user.cliente_id);
        updateQuery = `UPDATE leads_tracking SET ${setClauses.join(', ')} WHERE id = $${queryIndex} AND cliente_id = $${queryIndex + 1} RETURNING *`;
      }

      const updateResult = await pool.query(updateQuery, values);
      
      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: 'Lead não encontrado ou não pertence ao seu cliente.' });
      }

      // Venda/Qualificação manual → módulo CAPI central (mesmo event_id determinístico
      // do disparo automático da jornada → não duplica o evento na Meta). Registra
      // também em lead_journey_history para o histórico unificado do lead.
      let capi = null;
      let lead = updateResult.rows[0];
      let concept = null;
      if (status === 'Vendido' || status === 'Venda') concept = 'purchase';
      else if (status === 'Qualificado') concept = 'qualified';

      // Enriquece o lead com dados do clique rastreável (fbc, fbp, ip, user_agent,
      // geo_city→cidade, geo_region→estado) que ficam em tracking_clicks, não em
      // leads_tracking. Sem isso o Advanced Matching e o canal website ficam incompletos.
      if (lead.tracking_click_id) {
        try {
          const clickRes = await pool.query(
            `SELECT fbc, fbp, ip_address, user_agent, referrer,
                    event_source_url, geo_city, geo_region
             FROM tracking_clicks WHERE id = $1`,
            [lead.tracking_click_id]
          );
          const click = clickRes.rows[0];
          if (click) {
            lead = {
              ...lead,
              fbc:              click.fbc              || null,
              fbp:              click.fbp              || null,
              ip_address:       click.ip_address       || null,
              user_agent:       click.user_agent       || null,
              referrer:         click.referrer         || null,
              event_source_url: lead.event_source_url  || click.event_source_url || null,
              cidade:           lead.cidade            || click.geo_city         || null,
              estado:           lead.estado            || click.geo_region       || null,
            };
          }
        } catch (_) { /* best-effort: falha no enriquecimento não bloqueia o update */ }
      }

      if (concept) {
        capi = await enviarConversao({
          lead, concept,
          value: concept === 'purchase' ? valor_venda : undefined,
          currency: 'BRL', pool,
        });
        capi = { sent: capi.sent, error: capi.error, fbtrace_id: capi.fbtrace_id };
        try {
          await pool.query(
            `INSERT INTO lead_journey_history
              (lead_id, cliente_id, event_concept, event_name, value, currency, channel,
               event_id, meta_status, meta_response, fbtrace_id, attempts, created_at, last_attempt_at)
             VALUES ($1,$2,$3,$4,$5,'BRL',$6,$7,$8,$9,$10,1,NOW(),NOW())`,
            [lead.id, lead.cliente_id, concept,
             concept === 'purchase' ? 'Purchase' : 'QualifiedLead',
             concept === 'purchase' ? parseFloat(valor_venda || 0) : null,
             lead.ctw_aci_id ? 'business_messaging' : 'website',
             `j_${lead.id}_${concept}`,
             capi.sent ? 'sent' : 'error', capi.sent ? null : (capi.error || 'falha'),
             capi.fbtrace_id || null]
          );
        } catch (_) { /* history é best-effort; o evento já foi enviado */ }
      }

      // O status do lead já foi salvo no banco. capi informa o resultado real do envio à Meta.
      return res.status(200).json({ ok: true, capi });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Leads UPDATE error:', error);
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[leads-update] mock update fallback:', error.message);
      return res.status(200).json({ ok: true, mock: true });
    }
    return res.status(500).json({ error: error.message || 'Erro ao atualizar.' });
  }
}
