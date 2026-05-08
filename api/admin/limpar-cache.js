import { getPool } from '../_db.js';
import { verifyAuth } from '../_auth.js';
import { cors } from '../_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['DELETE', 'POST'])) return;

  const user = await verifyAuth(req, res);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }

  try {
    const pool = getPool();
    const result = await pool.query("DELETE FROM metrics_cache WHERE data_referencia < NOW() - INTERVAL '180 days'");
    
    console.log(`[ADMIN] Cache limpo: ${result.rowCount} registros removidos.`);
    
    res.status(200).json({ 
      success: true, 
      message: `Limpeza concluída. ${result.rowCount} registros removidos.`,
      deletedCount: result.rowCount 
    });
  } catch (error) {
    console.error('[ADMIN] Erro ao limpar cache:', error);
    res.status(500).json({ error: 'Erro ao processar limpeza de cache' });
  }
}
