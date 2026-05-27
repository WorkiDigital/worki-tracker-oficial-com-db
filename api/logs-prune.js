import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  // Apenas admins podem disparar a limpeza manual via API
  if (cors(req, res, ['POST', 'GET'])) return;

  const user = await verifyAuth(req, res);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const { days = 15 } = req.query;
  const pool = getPool();

  try {
    const result = await pool.query(
      `DELETE FROM public.webhook_logs WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );

    console.log(`[PRUNE] Limpeza de logs concluída. Registros removidos: ${result.rowCount}`);

    return res.status(200).json({ 
      success: true, 
      message: `Limpeza concluída. ${result.rowCount} logs removidos.`,
      deletedCount: result.rowCount 
    });
  } catch (err) {
    console.error('[PRUNE] Erro ao limpar logs:', err);
    return res.status(500).json({ error: 'Erro interno ao processar limpeza.' });
  }
}
