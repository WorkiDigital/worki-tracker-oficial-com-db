// Resultado de anúncios por META DE CONVERSÃO (optimization_goal) do conjunto — igual ao Gerenciador da Meta.
// ⚠️ Cópia server-side da lógica de `resultFromGoal`/`getResultadoParts` do index.html (painel).
// Mantenha as duas alinhadas (ver seção "Métrica Resultados" no CLAUDE.md).
// Regras: um único action_type por métrica (first-match, NUNCA somar variantes); alguns resultados
// vêm em `conversions` e não em `actions` (ex.: contact_website).

const PIXEL_EVENT_LABEL = {
  lead: 'Leads', contact: 'Contatos', purchase: 'Compras', complete_registration: 'Cadastros',
  add_to_cart: 'Adições ao carrinho', initiate_checkout: 'Checkouts', schedule: 'Agendamentos',
  submit_application: 'Inscrições', subscribe: 'Assinaturas', view_content: 'Visualizações de conteúdo',
  add_payment_info: 'Info. de pagamento', add_to_wishlist: 'Lista de desejos', search: 'Buscas',
  start_trial: 'Testes iniciados', find_location: 'Localizações', customize_product: 'Personalizações',
  donate: 'Doações',
};

const RESULT_BY_OBJECTIVE = {
  OUTCOME_LEADS: { label: 'Leads', keys: ['lead', 'offsite_conversion.lead'] },
  OUTCOME_ENGAGEMENT: { label: 'Conversas', keys: ['onsite_conversion.messaging_conversation_started_7d'] },
  OUTCOME_SALES: { label: 'Compras', keys: ['omni_purchase', 'purchase'] },
  OUTCOME_AWARENESS: { label: 'Alcance', reach: true },
};
const LEGACY_OBJECTIVE = {
  LEAD_GENERATION: 'OUTCOME_LEADS', MESSAGES: 'OUTCOME_ENGAGEMENT', CONVERSIONS: 'OUTCOME_SALES',
  PRODUCT_CATALOG_SALES: 'OUTCOME_SALES', REACH: 'OUTCOME_AWARENESS', BRAND_AWARENESS: 'OUTCOME_AWARENESS',
};

export function getActOrConv(ins, keys) {
  for (const k of keys) {
    const a = ins?.conversions?.find(x => x.action_type === k) || ins?.actions?.find(x => x.action_type === k);
    if (a) return parseFloat(a.value || 0);
  }
  return 0;
}

function fromObjective(ins, objective) {
  const cfg = RESULT_BY_OBJECTIVE[objective] || RESULT_BY_OBJECTIVE[LEGACY_OBJECTIVE[objective]];
  if (cfg) {
    return { label: cfg.label, value: cfg.reach ? parseInt(ins?.reach || 0, 10) : getActOrConv(ins, cfg.keys) };
  }
  // Objetivo desconhecido (ex.: Tráfego): maior valor entre compras/leads/conversas, nunca soma.
  const cands = [
    { label: 'Compras', value: getActOrConv(ins, ['omni_purchase', 'purchase']) },
    { label: 'Leads', value: getActOrConv(ins, ['lead', 'offsite_conversion.lead']) },
    { label: 'Conversas', value: getActOrConv(ins, ['onsite_conversion.messaging_conversation_started_7d']) },
  ];
  return cands.reduce((a, b) => (b.value > a.value ? b : a));
}

export function resultFromGoal(ins, goal, event, eventStr) {
  let spec = null;
  switch (goal) {
    case 'LEAD_GENERATION': case 'QUALITY_LEAD':
      spec = { label: 'Leads', keys: ['lead', 'onsite_conversion.lead_grouped'] }; break;
    case 'CONVERSATIONS':
      spec = { label: 'Conversas', keys: ['onsite_conversion.messaging_conversation_started_7d'] }; break;
    case 'LANDING_PAGE_VIEWS':
      spec = { label: 'Visualizações da página', keys: ['landing_page_view'] }; break;
    case 'REACH':
      return { label: 'Alcance', value: parseInt(ins?.reach || 0, 10) };
    case 'OFFSITE_CONVERSIONS': case 'VALUE': case 'CONVERSIONS': {
      const ev = String(event || '').toLowerCase();
      if (ev === 'other') {
        if (!eventStr) return null;
        return { label: eventStr, value: getActOrConv(ins, [`offsite_conversion.fb_pixel_custom.${eventStr}`]) || 0 };
      }
      if (!ev) return null;
      const keys = [`omni_${ev}`, `offsite_conversion.fb_pixel_${ev}`, `${ev}_website`, `${ev}_total`, ev];
      if (ev === 'lead') keys.push('offsite_conversion.lead');
      spec = { label: PIXEL_EVENT_LABEL[ev] || ev, keys }; break;
    }
    default: return null;
  }
  return { label: spec.label, value: getActOrConv(ins, spec.keys) || 0 };
}

// Resultado de UM conjunto (meta do conjunto; cai no objetivo da campanha se a meta não estiver mapeada).
export function resultadoDoConjunto(ins, adset, objective) {
  return resultFromGoal(ins, adset?.optimization_goal, adset?.promoted_object?.custom_event_type, adset?.promoted_object?.custom_event_str)
    || fromObjective(ins, objective);
}

// Agrupa por tipo (nunca mistura tipos). Retorna [{tipo, valor}].
export function somarPorTipo(resultados) {
  const acc = {};
  for (const r of resultados) {
    if (r && r.value) acc[r.label] = (acc[r.label] || 0) + r.value;
  }
  return Object.entries(acc).map(([tipo, valor]) => ({ tipo, valor }));
}
