import { verifyAuth, getTokenForUser } from './_auth.js';
import { normalizeAccountId, verifyAccountAccess } from './_validate.js';
import { fetchMeta } from './_meta-client.js';
import { cacheDeletePrefix } from './_cache.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';
import { log } from './_logger.js';

const ENTITY_TYPES = new Set(['campaign', 'adset']);
const GRAPH = 'https://graph.facebook.com/v23.0';

function budgetAtual(entity) {
  const daily = Number(entity?.daily_budget);
  if (Number.isSafeInteger(daily) && daily > 0) {
    return { field: 'daily_budget', value: daily, type: 'daily' };
  }
  const lifetime = Number(entity?.lifetime_budget);
  if (Number.isSafeInteger(lifetime) && lifetime > 0) {
    return { field: 'lifetime_budget', value: lifetime, type: 'lifetime' };
  }
  return null;
}

function metaErrorMessage(error) {
  const message = error?.message || 'A Meta recusou a alteração de orçamento.';
  if (error?.code === 200 || /permission|ads_management|permiss/i.test(message)) {
    return 'O token Meta não possui permissão ads_management para alterar orçamentos.';
  }
  return message;
}

export default async function handler(req, res) {
  if (cors(req, res, ['PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const {
    accountId,
    entity_type,
    entity_id,
    new_budget_minor,
    cliente_id,
  } = req.body || {};

  if (!accountId) return res.status(400).json({ error: 'accountId é obrigatório.' });
  if (!ENTITY_TYPES.has(entity_type)) {
    return res.status(400).json({ error: 'entity_type deve ser campaign ou adset.' });
  }
  if (!/^\d+$/.test(String(entity_id || ''))) {
    return res.status(400).json({ error: 'ID da entidade inválido.' });
  }

  const newBudget = Number(new_budget_minor);
  if (!Number.isSafeInteger(newBudget) || newBudget <= 0) {
    return res.status(400).json({ error: 'Informe um orçamento válido em unidades monetárias mínimas.' });
  }
  if (!(await verifyAccountAccess(user, accountId, cliente_id))) {
    return res.status(403).json({ error: 'Acesso negado a esta conta de anúncios.' });
  }

  const token = await getTokenForUser(user);
  if (!token) {
    return res.status(403).json({ error: 'Token Meta não configurado para esta conta.' });
  }

  try {
    const typeField = entity_type === 'campaign' ? 'objective' : 'campaign_id';
    const fields = `id,name,account_id,daily_budget,lifetime_budget,status,effective_status,${typeField}`;
    const checkResponse = await fetchMeta(
      `${GRAPH}/${entity_id}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`
    );
    const entity = await checkResponse.json();
    if (entity.error) {
      return res.status(400).json({ error: metaErrorMessage(entity.error) });
    }
    if (normalizeAccountId(entity.account_id) !== normalizeAccountId(accountId)) {
      return res.status(403).json({ error: 'A entidade não pertence à conta de anúncios informada.' });
    }

    const current = budgetAtual(entity);
    if (!current) {
      return res.status(409).json({
        error: entity_type === 'campaign'
          ? 'Esta campanha não controla orçamento. Ajuste o orçamento nos conjuntos.'
          : 'Este conjunto não controla orçamento. Ajuste o orçamento na campanha.',
      });
    }
    if (newBudget <= current.value) {
      return res.status(400).json({
        error: 'O novo orçamento deve ser maior que o orçamento atual.',
        current_budget_minor: current.value,
      });
    }

    const body = new URLSearchParams({
      [current.field]: String(newBudget),
      access_token: token,
    });
    const updateResponse = await fetchMeta(`${GRAPH}/${entity_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      maxRetries: 1,
    });
    const updated = await updateResponse.json();
    if (!updateResponse.ok || updated.error || updated.success !== true) {
      return res.status(400).json({ error: metaErrorMessage(updated.error) });
    }

    await Promise.all([
      cacheDeletePrefix(`ads:${accountId}:`),
      cacheDeletePrefix(`children:${accountId}:`),
    ]);

    log('info', 'meta_ads_budget_increased', {
      user_id: user.id || null,
      cliente_id: user.cliente_id || null,
      account_id: normalizeAccountId(accountId),
      entity_type,
      entity_id: String(entity_id),
      budget_type: current.type,
      old_budget_minor: current.value,
      new_budget_minor: newBudget,
    });

    return res.status(200).json({
      success: true,
      entity_id: String(entity_id),
      entity_name: entity.name || null,
      entity_type,
      budget_type: current.type,
      old_budget_minor: current.value,
      new_budget_minor: newBudget,
    });
  } catch (error) {
    log('error', 'meta_ads_budget_increase_failed', {
      user_id: user.id || null,
      account_id: normalizeAccountId(accountId),
      entity_type,
      entity_id: String(entity_id || ''),
      error: error.message,
    });
    return res.status(500).json({ error: error.message || 'Erro ao alterar orçamento na Meta.' });
  }
}
