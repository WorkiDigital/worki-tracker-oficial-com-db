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
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
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
