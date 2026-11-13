// MCP (Model Context Protocol) de LEITURA — transporte HTTP "Streamable" (JSON-RPC 2.0 via POST).
// Acesso total da agência (todos os clientes) por chave de API de admin.
//   - Chave no cabeçalho:  Authorization: Bearer mcp_xxx       (preferido)
//   - Chave na URL:        /api/mcp/mcp_xxx                    (alternativa p/ apps que não aceitam cabeçalho)
// Somente leitura, sem dados pessoais. Ver api/_mcp-tools.js.
import crypto from 'crypto';
import { getPool } from './_db.js';
import { ensureMcpSchema } from './_mcp-schema.js';
import { TOOLS, RESOURCES, AVISOS_BASE } from './_mcp-tools.js';
import { rateLimit } from './_rate-limit.js';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'adlytics-pro-mcp', version: '1.0.0' };
const TOOLS_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

export const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

function setCors(req, res) {
  // A segurança vem da chave, não da origem — MCP é chamado por clientes variados (CLI, apps de chat).
  res.setHeader('Access-Control-Allow-Origin', req.headers?.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, X-MCP-Key, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
}

function extractKey(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  // Alguns apps de chat reservam "Authorization" e só deixam enviar cabeçalho com outro nome.
  const custom = String(req.headers['x-api-key'] || req.headers['x-mcp-key'] || '').replace(/^Bearer\s+/i, '').trim();
  return bearer || custom || String(req.query?.id || '').trim();
}

async function authenticate(req) {
  const key = extractKey(req);
  if (!key || !key.startsWith('mcp_') || key.length < 20 || key.length > 200) return null;
  const r = await getPool().query(
    'SELECT id, nome, allow_pii FROM mcp_api_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [hashKey(key)]
  );
  if (!r.rows.length) return null;
  getPool().query('UPDATE mcp_api_keys SET last_used_at = NOW() WHERE id = $1', [r.rows[0].id]).catch(() => {});
  return r.rows[0];
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function audit(keyId, tool, args, ok, error, ms) {
  try {
    const cid = Number.parseInt(args?.cliente_id, 10);
    await getPool().query(
      `INSERT INTO mcp_audit_log (key_id, tool, cliente_id, args, ok, error, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [keyId, tool, Number.isInteger(cid) ? cid : null, JSON.stringify(args || {}), ok, error ? String(error).slice(0, 500) : null, ms]
    );
  } catch { /* auditoria é best-effort, nunca derruba a resposta */ }
}

async function callTool(keyRow, params) {
  const name = params?.name;
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool || (tool.requiresPii && !keyRow.allow_pii)) {
    // Para chave sem escopo, a ferramenta de dados pessoais "não existe".
    return { isError: true, content: [{ type: 'text', text: `Ferramenta desconhecida: ${name}` }] };
  }
  const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  const t0 = Date.now();
  try {
    const data = await tool.run(args, { allowPii: !!keyRow.allow_pii });
    await audit(keyRow.id, name, args, true, null, Date.now() - t0);
    const payload = { ...data, _contexto: { fuso: 'America/Sao_Paulo', moeda: 'BRL', avisos: AVISOS_BASE } };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  } catch (err) {
    await audit(keyRow.id, name, args, false, err.message, Date.now() - t0);
    console.error('[mcp] erro na ferramenta', name, err.message);
    // Só repassa mensagens de validação (nossas); erro de banco vira mensagem genérica.
    const msg = /inválid/i.test(err.message || '') ? err.message : 'Erro ao consultar os dados.';
    return { isError: true, content: [{ type: 'text', text: msg }] };
  }
}

async function handleMessage(keyRow, msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const wanted = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(wanted) ? wanted : SUPPORTED_VERSIONS[1],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Leia o recurso adlytics://dicionario-de-metricas antes de interpretar números. Comece por listar_clientes e use cliente_id nas demais ferramentas. Somente leitura. Dados pessoais só em chaves com esse escopo.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.filter(t => !t.requiresPii || keyRow.allow_pii)
          .map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case 'tools/call':
      return rpcResult(id, await callTool(keyRow, params));
    case 'resources/list':
      return rpcResult(id, {
        resources: RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })),
      });
    case 'resources/read': {
      const r = RESOURCES.find(x => x.uri === params?.uri);
      if (!r) return rpcError(id, -32002, 'Recurso não encontrado.');
      return rpcResult(id, { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] });
    }
    default:
      if (isNotification || String(method || '').startsWith('notifications/')) return null;
      return rpcError(id, -32601, `Método não suportado: ${method}`);
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method === 'GET' || req.method === 'DELETE') {
    // Sem stream de servidor nem sessões: o spec permite responder 405.
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Use POST (JSON-RPC).' });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }

  try {
    await ensureMcpSchema();
    const keyRow = await authenticate(req);
    if (!keyRow) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Chave inválida ou revogada.' });
      return;
    }
    if (await rateLimit(req, res, { id: `mcp_${keyRow.id}` })) return;

    const body = req.body;
    const batch = Array.isArray(body);
    const messages = batch ? body : [body];
    if (!messages.length || messages.length > 20) {
      res.status(400).json(rpcError(null, -32600, 'Requisição inválida.'));
      return;
    }

    const responses = [];
    for (const m of messages) {
      if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
        responses.push(rpcError(m?.id, -32600, 'Requisição JSON-RPC inválida.'));
        continue;
      }
      const out = await handleMessage(keyRow, m);
      if (out) responses.push(out);
    }

    if (!responses.length) { res.status(202).end(); return; } // só notificações
    res.status(200).json(batch ? responses : responses[0]);
  } catch (err) {
    console.error('[mcp]', err.message);
    res.status(500).json(rpcError(null, -32603, 'Erro interno.'));
  }
}
