import { getPool } from '../_db.js';
import { ensureChatMessagesSchema } from '../_chat-schema.js';

export async function runChatCleanup() {
  await ensureChatMessagesSchema();
  const result = await getPool().query(
    `DELETE FROM public.chat_messages
     WHERE message_at < NOW() - INTERVAL '15 days'`
  );
  return { success: true, deletedCount: result.rowCount };
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  // Fail-closed: CRON_SECRET é sempre obrigatório para a rota HTTP — sem ele
  // ficaria aberta para qualquer requisição sem autenticação nenhuma. Não
  // depende de NODE_ENV (o ambiente real de produção pode não ter essa env
  // setada). O tick interno do cron (setInterval em server.js) não passa por
  // aqui — chama runChatCleanup() diretamente, sem HTTP.
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET não configurado no servidor.' });
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }

  try {
    const result = await runChatCleanup();
    return res.status(200).json(result);
  } catch (error) {
    console.error('[ChatCleanup HTTP]', error);
    return res.status(500).json({ error: error.message });
  }
}
