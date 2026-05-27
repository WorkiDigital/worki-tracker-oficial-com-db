import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;
  if (await rateLimit(req, res, user)) return;

  const EVO_URL = process.env.EVOLUTION_API_URL;
  const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;

  if (!EVO_URL || !EVO_KEY) {
    return res.status(500).json({ error: 'Configuração da Evolution API ausente no servidor.' });
  }

  const { instanceName } = req.query;
  if (!instanceName) {
    return res.status(400).json({ error: 'Parâmetro instanceName é obrigatório.' });
  }

  // Segurança multi-tenant: admin passa direto; cliente deve ter instância com prefixo
  // OU vinculada na tabela instancias_mapeamento
  if (!user.is_admin) {
    const prefix = `cliente_${user.cliente_id}_`;
    if (!instanceName.startsWith(prefix)) {
      const pool = getPool();
      const linked = await pool.query(
        'SELECT id FROM instancias_mapeamento WHERE instance_name = $1 AND cliente_id = $2',
        [instanceName, user.cliente_id]
      );
      if (linked.rowCount === 0) {
        return res.status(403).json({ error: 'Acesso negado a esta instância.' });
      }
    }
  }

  try {
    const headers = {
      'apikey': EVO_KEY,
      'Content-Type': 'application/json'
    };

    // A Evolution API tem a rota para buscar todos os grupos usando getParticipants=false
    const r = await fetch(`${EVO_URL}/group/fetchAll/${instanceName}?getParticipants=false`, { 
        method: 'GET',
        headers 
    });
    
    if (!r.ok) {
        const errorData = await r.text();
        return res.status(r.status).json({ error: 'Falha ao buscar grupos da Evolution API.', details: errorData });
    }

    const data = await r.json();
    
    // Filtra e formata para enviar apenas o necessário ao frontend
    // O retorno da Evolution normalmente é um array de grupos com { id, subject }
    const groups = Array.isArray(data) ? data.map(g => ({
        id: g.id, 
        name: g.subject || 'Grupo Sem Nome'
    })) : [];

    // Ordena alfabeticamente
    groups.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json(groups);

  } catch (error) {
    console.error('[evo-groups] Erro ao buscar grupos:', error);
    return res.status(500).json({ error: error.message });
  }
}
