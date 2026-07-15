import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { encryptToken } from './_crypto.js';
import { rateLimit } from './_rate-limit.js';

function parseClienteId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveClienteId(user, req) {
  if (!user?.is_admin) return user?.cliente_id || null;
  return parseClienteId(req.query?.cliente_id || req.body?.cliente_id);
}

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const clienteId = resolveClienteId(user, req);
  if (!clienteId) {
    return res.status(400).json({ error: 'Selecione um cliente para gerenciar integracoes.' });
  }

  try {
    const pool = getPool();

    if (req.method === 'GET') {
      const result = await pool.query(`
        SELECT
          id,
          nome,
          email_contato,
          pixel_padrao,
          google_ads_conversion_id,
          google_ads_conversion_label,
          capi_pixel_id,
          token_last4,
          capi_token_last4
        FROM clientes
        WHERE id = $1
      `, [clienteId]);

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Cliente nao encontrado.' });
      }

      const row = result.rows[0];
      return res.status(200).json({
        cliente_id: row.id,
        cliente_nome: row.nome || row.email_contato || `Cliente #${row.id}`,
        integracoes: {
          pixel_padrao: row.pixel_padrao,
          google_ads_conversion_id: row.google_ads_conversion_id,
          google_ads_conversion_label: row.google_ads_conversion_label,
          capi_pixel_id: row.capi_pixel_id,
          token_last4: row.token_last4,
          capi_token_last4: row.capi_token_last4
        }
      });
    }

    if (req.method !== 'PATCH') {
      return res.status(405).json({ error: 'Metodo nao permitido.' });
    }

    const {
      pixel_padrao,
      token_meta,
      capi_pixel_id,
      capi_token,
      google_ads_conversion_id,
      google_ads_conversion_label
    } = req.body || {};

    const fields = [];
    const values = [];
    let idx = 1;

    if (pixel_padrao !== undefined) {
      fields.push(`pixel_padrao=$${idx++}`);
      values.push(pixel_padrao || null);
    }
    if (token_meta) {
      fields.push(`token_meta_enc=$${idx++}`);
      values.push(encryptToken(token_meta));
      fields.push(`token_last4=$${idx++}`);
      values.push(token_meta.slice(-6));
      fields.push(`token_updated_at=$${idx++}`);
      values.push(new Date());
    }
    if (capi_pixel_id !== undefined) {
      fields.push(`capi_pixel_id=$${idx++}`);
      values.push(capi_pixel_id || null);
    }
    if (capi_token) {
      fields.push(`capi_token_enc=$${idx++}`);
      values.push(encryptToken(capi_token));
      fields.push(`capi_token_last4=$${idx++}`);
      values.push(capi_token.slice(-6));
      fields.push(`capi_token_updated_at=$${idx++}`);
      values.push(new Date());
    }
    if (google_ads_conversion_id !== undefined) {
      fields.push(`google_ads_conversion_id=$${idx++}`);
      values.push(google_ads_conversion_id || null);
    }
    if (google_ads_conversion_label !== undefined) {
      fields.push(`google_ads_conversion_label=$${idx++}`);
      values.push(google_ads_conversion_label || null);
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'Nenhum dado enviado para atualizacao.' });
    }

    values.push(clienteId);
    await pool.query(
      `UPDATE clientes SET ${fields.join(', ')} WHERE id = $${idx}`,
      values
    );

    return res.status(200).json({ success: true, message: 'Integracoes salvas com sucesso.' });
  } catch (error) {
    console.error('me-integracoes error:', error);
    return res.status(500).json({ error: 'Erro ao atualizar as integracoes.' });
  }
}
