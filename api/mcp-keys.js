// Gerência das chaves do MCP de leitura. SOMENTE admin da agência.
//   GET    -> lista chaves (sem o segredo)
//   POST   { nome } -> cria chave; o segredo completo é devolvido UMA ÚNICA VEZ
//   DELETE ?id=N    -> revoga
import crypto from 'crypto';
import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { ensureMcpSchema } from './_mcp-schema.js';
import { hashKey } from './mcp.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (!user.is_admin) return res.status(403).json({ error: 'Apenas administradores da agência.' });

  try {
    await ensureMcpSchema();
    const pool = getPool();

    if (req.method === 'GET' && req.query.audit === '1') {
      // Ultimas chamadas ao MCP (sem os argumentos completos, so ferramenta/cliente/resultado)
      const r = await pool.query(
        `SELECT a.created_at, a.tool, a.ok, a.duration_ms, a.cliente_id, c.nome AS cliente, k.nome AS chave
         FROM mcp_audit_log a
         LEFT JOIN mcp_api_keys k ON k.id = a.key_id
         LEFT JOIN clientes c ON c.id = a.cliente_id
         ORDER BY a.created_at DESC LIMIT 25`
      );
      return res.status(200).json(r.rows);
    }

    if (req.method === 'GET') {
      const r = await pool.query(
        `SELECT id, nome, last4, created_at, last_used_at, revoked_at
         FROM mcp_api_keys ORDER BY created_at DESC LIMIT 100`
      );
      return res.status(200).json(r.rows);
    }

    if (req.method === 'POST') {
      const nome = String(req.body?.nome || '').trim().slice(0, 120);
      if (!nome) return res.status(400).json({ error: 'nome é obrigatório.' });
      const key = `mcp_${crypto.randomBytes(24).toString('hex')}`;
      const r = await pool.query(
        `INSERT INTO mcp_api_keys (nome, key_hash, last4, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id, nome, last4, created_at`,
        [nome, hashKey(key), key.slice(-4), user.id || null]
      );
      return res.status(201).json({
        ...r.rows[0],
        key, // única vez em que o segredo aparece
        aviso: 'Guarde esta chave agora. Ela não poderá ser exibida novamente.',
      });
    }

    if (req.method === 'DELETE') {
      const id = Number.parseInt(req.query.id || req.body?.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'id é obrigatório.' });
      const r = await pool.query(
        'UPDATE mcp_api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id',
        [id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Chave não encontrada ou já revogada.' });
      return res.status(200).json({ revoked: id });
    }
  } catch (err) {
    console.error('[mcp-keys]', err.message);
    return res.status(500).json({ error: 'Erro ao gerenciar chaves.' });
  }
}
