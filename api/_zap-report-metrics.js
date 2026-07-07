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
    reach = 0, roasValue = 0, campaign_count = 0;

  for (const campaign of campaigns || []) {
    if (!matchesCampaignFilters(campaign, filters)) continue;
    const ins = campaign.insights?.data?.[0];
    if (!ins) continue;
    campaign_count++;
    spend       += parseFloat(ins.spend       || 0);
    impressions += parseInt(ins.impressions   || 0, 10);
    clicks      += parseInt(ins.clicks        || 0, 10);
    reach       += parseInt(ins.reach         || 0, 10);

    for (const action of (ins.actions || [])) {
      if (action.action_type === 'lead') leads += parseInt(action.value || 0, 10);
      if (action.action_type === 'onsite_conversion.messaging_conversation_started_7d') {
        msgs += parseInt(action.value || 0, 10);
      }
    }

    for (const roas of (ins.purchase_roas || [])) {
      if (roas.action_type === 'omni_purchase') roasValue += parseFloat(roas.value || 0);
    }
  }

  const cpl  = leads       > 0 ? spend / leads : 0;
  const cpr  = msgs        > 0 ? spend / msgs : 0;
  const cpc  = clicks      > 0 ? spend / clicks : 0;
  const cpm  = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const ctr  = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const roas = spend       > 0 ? roasValue / spend : 0;

  return {
    spend, impressions, clicks, reach, leads, msgs,
    cpl, cpr, cpc, cpm, ctr, roas, campaign_count,
  };
}
