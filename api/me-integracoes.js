import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';
import { encryptToken } from './_crypto.js';
import { rateLimit } from './_rate-limit.js';

export default async function handler(req, res) {
  if (cors(req, res, ['PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  if (!user.cliente_id) {
    return res.status(403).json({ error: 'Conta de administrador global não pode editar integrações aqui.' });
  }

  const { pixel_padrao, token_meta, capi_pixel_id, capi_token, google_ads_conversion_id, google_ads_conversion_label } = req.body;

  try {
    const pool = getPool();
    const fields = [];
    const values = [];
    let idx = 1;

    if (pixel_padrao !== undefined) { fields.push(`pixel_padrao=$${idx++}`); values.push(pixel_padrao || null); }
    if (token_meta) {
        fields.push(`token_meta_enc=$${idx++}`);   values.push(encryptToken(token_meta));
        fields.push(`token_last4=$${idx++}`);      values.push(token_meta.slice(-6));
        fields.push(`token_updated_at=$${idx++}`); values.push(new Date());
    }
    if (capi_pixel_id !== undefined) { fields.push(`capi_pixel_id=$${idx++}`); values.push(capi_pixel_id || null); }
    if (capi_token) {
        fields.push(`capi_token_enc=$${idx++}`);      values.push(encryptToken(capi_token));
        fields.push(`capi_token_last4=$${idx++}`);    values.push(capi_token.slice(-6));
        fields.push(`capi_token_updated_at=$${idx++}`); values.push(new Date());
    }
    if (google_ads_conversion_id !== undefined) { fields.push(`google_ads_conversion_id=$${idx++}`); values.push(google_ads_conversion_id || null); }
    if (google_ads_conversion_label !== undefined) { fields.push(`google_ads_conversion_label=$${idx++}`); values.push(google_ads_conversion_label || null); }

    if (!fields.length) {
        return res.status(400).json({ error: 'Nenhum dado enviado para atualização.' });
    }

    values.push(user.cliente_id);
    await pool.query(
        `UPDATE clientes SET ${fields.join(', ')} WHERE id = $${idx}`,
        values
    );

    return res.status(200).json({ success: true, message: 'Integrações salvas com sucesso.' });
  } catch (error) {
    console.error('me-integracoes error:', error);
    return res.status(500).json({ error: 'Erro ao atualizar as integrações.' });
  }
}
