// GET/PATCH /api/alerta-saldo-config — configuração GLOBAL (não por cliente)
// de para onde vai o alerta de saldo baixo (api/cron/check-ads-balance.js).
// Reaproveita a tabela genérica configuracoes_sistema (chave/valor) já usada
// pelo white-label (api/config-update.js) em vez de criar uma tabela nova —
// só mais 2 chaves. Admin-only (diferente de api/config.js, que é público:
// instância/destino de WhatsApp não devem vazar sem autenticação).
import { getPool } from './_db.js';
import { verifyAuth } from './_auth.js';
import { cors } from './_cors.js';

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS public.configuracoes_sistema (
    id SERIAL PRIMARY KEY,
    chave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

const CHAVES = {
  instance: 'alerta_saldo_instance',
  tipo: 'alerta_saldo_tipo',       // 'grupo' | 'contato'
  jid: 'alerta_saldo_destino_jid', // JID do grupo OU número normalizado do contato
  nome: 'alerta_saldo_destino_nome', // nome do grupo/contato, só para exibição na tela
};

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'PATCH'])) return;

  const user = await verifyAuth(req, res);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Acesso negado: Requer privilégios de administrador.' });
  }

  const pool = getPool();
  await pool.query(ENSURE_TABLE);

  if (req.method === 'GET') {
    try {
      const { rows } = await pool.query(
        'SELECT chave, valor FROM configuracoes_sistema WHERE chave = ANY($1)',
        [Object.values(CHAVES)]
      );
      const map = {};
      rows.forEach(r => { map[r.chave] = r.valor; });
      return res.status(200).json({
        instance: map[CHAVES.instance] || '',
        tipo: map[CHAVES.tipo] || 'grupo',
        jid: map[CHAVES.jid] || '',
        nome: map[CHAVES.nome] || '',
      });
    } catch (err) {
      console.error('[alerta-saldo-config] GET erro:', err.message);
      return res.status(500).json({ error: 'Erro ao carregar configuração.' });
    }
  }

  if (req.method === 'PATCH') {
    const { instance, tipo, jid, nome } = req.body || {};
    if (!instance || !jid) {
      return res.status(400).json({ error: 'Instância e destino são obrigatórios.' });
    }
    if (tipo !== 'grupo' && tipo !== 'contato') {
      return res.status(400).json({ error: 'Tipo de destino inválido.' });
    }
    try {
      const upsert = async (chave, valor) => pool.query(`
        INSERT INTO configuracoes_sistema (chave, valor, atualizado_em)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP
      `, [chave, valor]);

      await upsert(CHAVES.instance, String(instance));
      await upsert(CHAVES.tipo, String(tipo));
      await upsert(CHAVES.jid, String(jid));
      await upsert(CHAVES.nome, String(nome || ''));

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[alerta-saldo-config] PATCH erro:', err.message);
      return res.status(500).json({ error: 'Erro ao salvar configuração.' });
    }
  }

  return res.status(405).json({ error: 'Método não permitido.' });
}
