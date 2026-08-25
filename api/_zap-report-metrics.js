export function normalizeCampaignFilters(input = {}) {
  const text = String(input.campaign_filter_text || '').trim().slice(0, 255);
  const terms = text
    .split(',')
    .map(term => term.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);

  const rawObjectives = Array.isArray(input.campaign_objectives)
    ? input.campaign_objectives
    : String(input.campaign_objectives || '').split(',');
  const objectives = rawObjectives
    .map(item => String(item || '').trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  return { text, terms, objectives };
}

export function matchesCampaignFilters(campaign, filters = {}) {
  const terms = Array.isArray(filters.terms) ? filters.terms : [];
  const objectives = Array.isArray(filters.objectives) ? filters.objectives : [];

  if (terms.length) {
    const name = String(campaign?.name || '').toLowerCase();
    if (!terms.some(term => name.includes(term))) return false;
  }

  if (objectives.length) {
    const objective = String(campaign?.objective || '').toUpperCase();
    if (!objectives.includes(objective)) return false;
  }

  return true;
}

export function summarizeZapCampaigns(campaigns, filters = {}) {
  let spend = 0, impressions = 0, clicks = 0, leads = 0, msgs = 0,
    reach = 0, roasWeightedSum = 0, roasSpendBase = 0, campaign_count = 0;

  for (const campaign of campaigns || []) {
    if (!matchesCampaignFilters(campaign, filters)) continue;
    const ins = campaign.insights?.data?.[0];
    if (!ins) continue;
    campaign_count++;
    const campSpend = parseFloat(ins.spend || 0);
    spend       += campSpend;
    impressions += parseInt(ins.impressions   || 0, 10);
    reach       += parseInt(ins.reach         || 0, 10);

    for (const action of (ins.actions || [])) {
      // Mesmo fallback usado em index.html/js/share-dash.js — algumas contas
      // reportam leads como 'offsite_conversion.lead', não só 'lead'.
      if (action.action_type === 'lead' || action.action_type === 'offsite_conversion.lead') {
        leads += parseInt(action.value || 0, 10);
      }
      if (action.action_type === 'onsite_conversion.messaging_conversation_started_7d') {
        msgs += parseInt(action.value || 0, 10);
      }
      // 'clicks' aqui é CLIQUES NO LINK (link_click), não o campo ins.clicks
      // bruto da Meta ("cliques todos" — qualquer interação clicável no
      // anúncio). Decisão do usuário: {cliques}, CTR e CPC do relatório de
      // WhatsApp usam todos link_click (Taxa de Cliques no Link), não mais
      // "cliques todos" — consistente entre si dentro deste relatório.
      if (action.action_type === 'link_click') {
        clicks += parseInt(action.value || 0, 10);
      }
    }

    // ROAS ponderado por gasto: Σ(roas×spend) / Σspend — nunca somar os
    // ratios direto (regra documentada no CLAUDE.md, mesma fórmula usada em
    // index.html e js/share-dash.js).
    const campRoas = (ins.purchase_roas || []).find(r => r.action_type === 'omni_purchase');
    if (campRoas && campSpend > 0) {
      roasWeightedSum += parseFloat(campRoas.value || 0) * campSpend;
      roasSpendBase   += campSpend;
    }
  }

  const cpl  = leads       > 0 ? spend / leads : 0;
  const cpr  = msgs        > 0 ? spend / msgs : 0;
  const cpc  = clicks      > 0 ? spend / clicks : 0;
  const cpm  = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const ctr  = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const roas = roasSpendBase > 0 ? roasWeightedSum / roasSpendBase : 0;

  return {
    spend, impressions, clicks, reach, leads, msgs,
    cpl, cpr, cpc, cpm, ctr, roas, campaign_count,
  };
}
