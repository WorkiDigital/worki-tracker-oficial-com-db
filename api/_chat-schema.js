import { getPool } from './_db.js';

let ensurePromise = null;

export async function ensureChatMessagesSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.chat_messages (
          id SERIAL PRIMARY KEY,
          cliente_id INTEGER NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
          lead_id INTEGER REFERENCES public.leads_tracking(id) ON DELETE SET NULL,
          instance VARCHAR(255) NOT NULL,
          telefone VARCHAR(50) NOT NULL,
          remote_jid VARCHAR(255),
          push_name VARCHAR(255),
          from_me BOOLEAN NOT NULL DEFAULT FALSE,
          message_id VARCHAR(255),
          body TEXT,
          message_type VARCHAR(50) DEFAULT 'text',
          media_url TEXT,
          message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_chat_messages_cliente_instance
          ON public.chat_messages(cliente_id, instance, message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
          ON public.chat_messages(cliente_id, instance, telefone, message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_ttl
          ON public.chat_messages(message_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_dedup
          ON public.chat_messages(instance, message_id)
          WHERE message_id IS NOT NULL;
      `);
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}
