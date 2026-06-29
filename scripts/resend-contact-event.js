/**
 * Reenvia o evento de conversão (padrão: Contact) para leads de link rastreável
 * que ainda não receberam o evento.
 *
 * Uso:
 *   RESEND_CAMPAIGN_ID=12 RESEND_DRY_RUN=true node -r dotenv/config scripts/resend-contact-event.js
 *
 * Variáveis de ambiente:
 *   RESEND_CAMPAIGN_ID  — ID da campanha em tracking_campaigns (obrigatório)
 *   RESEND_CONCEPT      — conceito do evento (padrão: o configurado na campanha; ex: contact)
 *   RESEND_DAYS         — quantos dias atrás buscar leads (padrão: 30)
 *   RESEND_DRY_RUN      — true = só lista, não envia (padrão: true)
 *   RESEND_LEAD_ID      — reenviar só para um lead específico
 */

import pg from 'pg';
import crypto from 'crypto';
import { decryptToken } from '../api/_crypto.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });

const CAMPAIGN_ID = parseInt(process.env.RESEND_CAMPAIGN_ID || '0');
if (!CAMPAIGN_ID) { console.error('RESEND_CAMPAIGN_ID é obrigatório.'); process.exit(1); }

const DRY_RUN   = process.env.RESEND_DRY_RUN !== 'false';
const DAYS      = parseInt(process.env.RESEND_DAYS || '30');
const LEAD_ID   = process.env.RESEND_LEAD_ID ? parseInt(process.env.RESEND_LEAD_ID) : null;
const GRAPH     = 'https://graph.facebook.com/v25.0';

const hash = (str) => {
  const s = (str || '').toLowerCase().trim();
  if (!s) return null;
  return /^[a-f0-9]{64}$/.test(s) ? s : crypto.createHash('sha256').update(s).digest('hex');
};

async function main() {
  // 1. Carrega a campanha
  const campRes = await pool.query(
    'SELECT id, name, conversion_event, conversion_auto, cliente_id FROM tracking_campaigns WHERE id = $1',
    [CAMPAIGN_ID]
  );
  if (!campRes.rows.length) { console.error('Campanha não encontrada:', CAMPAIGN_ID); process.exit(1); }
  const camp = campRes.rows[0];

  const concept = process.env.RESEND_CONCEPT || camp.conversion_event || 'contact';
  console.log(`\nCampanha: "${camp.name}" (id=${camp.id})`);
  console.log(`Conceito: ${concept} | Dias: ${DAYS} | Dry run: ${DRY_RUN}\n`);

  // 2. Carrega credenciais CAPI web do cliente
  const cliRes = await pool.query(
    'SELECT capi_pixel_id, capi_token_enc FROM clientes WHERE id = $1',
    [camp.cliente_id]
  );
  const cli = cliRes.rows[0];
  if (!cli?.capi_pixel_id || !cli?.capi_token_enc) {
    console.error('Cliente sem pixel/token CAPI web configurado. Configure em Gestão de Clientes → CAPI Web.');
    process.exit(1);
  }
  let token;
  try { token = decryptToken(cli.capi_token_enc); }
  catch (e) { console.error('Falha ao descriptografar token CAPI web:', e.message); process.exit(1); }

  const EVENT_NAME_MAP = {
    contact: 'Contact', lead: 'Lead', qualified: 'QualifiedLead',
    complete_registration: 'CompleteRegistration', appointment: 'Schedule',
    add_to_cart: 'AddToCart', checkout: 'InitiateCheckout', purchase: 'Purchase',
    subscribe: 'Subscribe', view_content: 'ViewContent', submit_application: 'SubmitApplication',
  };
  const eventName = EVENT_NAME_MAP[concept];
  if (!eventName) { console.error('Conceito inválido:', concept); process.exit(1); }

  // 3. Busca leads do link que ainda não receberam este evento
  const leadQuery = `
    SELECT
      l.id, l.nome, l.telefone, l.cliente_id, l.tracking_click_id,
      l.created_at,
      k.fbc, k.fbp, k.ip_address, k.user_agent, k.event_source_url, k.referrer,
      k.utm_campaign, k.utm_medium, k.utm_content
    FROM leads_tracking l
    JOIN tracking_clicks k ON k.id = l.tracking_click_id
    WHERE l.tracking_campaign_id = $1
      AND l.created_at >= NOW() - INTERVAL '${DAYS} days'
      ${LEAD_ID ? 'AND l.id = ' + LEAD_ID : ''}
      AND NOT EXISTS (
        SELECT 1 FROM lead_journey_history jh
        WHERE jh.lead_id = l.id
          AND jh.event_id = 'j_' || l.id || '_' || $2
          AND jh.meta_status = 'sent'
      )
    ORDER BY l.created_at DESC
  `;

  const leadsRes = await pool.query(leadQuery, [CAMPAIGN_ID, concept]);
  const leads = leadsRes.rows;

  console.log(`Leads encontrados sem evento "${eventName}": ${leads.length}`);
  if (!leads.length) { await pool.end(); return; }

  let ok = 0, fail = 0;

  for (const lead of leads) {
    const eventId = `j_${lead.id}_${concept}`;
    const ph = (lead.telefone || '').replace(/\D/g, '');

    const userData = {};
    if (lead.fbc)        userData.fbc                = lead.fbc;
    if (lead.fbp)        userData.fbp                = lead.fbp;
    if (ph)              userData.ph                 = [hash(ph)];
    if (lead.ip_address) userData.client_ip_address  = lead.ip_address;
    if (lead.user_agent) userData.client_user_agent  = lead.user_agent;

    const payload = {
      data: [{
        event_name:       eventName,
        event_time:       Math.floor(new Date(lead.created_at).getTime() / 1000),
        event_id:         eventId,
        action_source:    'website',
        event_source_url: lead.event_source_url || lead.referrer || undefined,
        user_data:        userData,
        custom_data: {
          ...(lead.utm_campaign ? { campaign: lead.utm_campaign } : {}),
        },
      }]
    };

    if (DRY_RUN) {
      console.log(`  [DRY] lead ${lead.id} (${lead.nome || lead.telefone}) | fbc=${lead.fbc || 'NULL'} | event_id=${eventId}`);
      continue;
    }

    try {
      const r = await fetch(
        `${GRAPH}/${cli.capi_pixel_id}/events?access_token=${token}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      const resp = await r.json();
      if (resp.events_received) {
        console.log(`  ✓ lead ${lead.id} (${lead.nome || lead.telefone}) → ${eventName} enviado | fbtrace=${resp.fbtrace_id}`);
        // Grava no histórico
        await pool.query(
          `INSERT INTO lead_journey_history
            (lead_id, cliente_id, event_concept, event_name, channel, event_id,
             meta_status, fbtrace_id, attempts, created_at, last_attempt_at)
           VALUES ($1,$2,$3,$4,'website',$5,'sent',$6,1,NOW(),NOW())
           ON CONFLICT DO NOTHING`,
          [lead.id, lead.cliente_id, concept, eventName, eventId, resp.fbtrace_id || null]
        );
        ok++;
      } else {
        const err = resp.error?.message || JSON.stringify(resp);
        console.log(`  ✗ lead ${lead.id} (${lead.nome || lead.telefone}) → FALHOU: ${err}`);
        fail++;
      }
    } catch (e) {
      console.log(`  ✗ lead ${lead.id} → ERRO: ${e.message}`);
      fail++;
    }
  }

  if (!DRY_RUN) {
    console.log(`\nConcluído: ${ok} enviados, ${fail} falhas.`);
  } else {
    console.log(`\n[DRY RUN] Nenhum evento enviado. Rode com RESEND_DRY_RUN=false para enviar.`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
