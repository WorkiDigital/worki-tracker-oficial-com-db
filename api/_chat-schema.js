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

        ALTER TABLE public.chat_messages
          ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES public.leads_tracking(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS remote_jid VARCHAR(255),
          ADD COLUMN IF NOT EXISTS push_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS from_me BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS message_id VARCHAR(255),
          ADD COLUMN IF NOT EXISTS body TEXT,
          ADD COLUMN IF NOT EXISTS message_type VARCHAR(50) DEFAULT 'text',
          ADD COLUMN IF NOT EXISTS media_url TEXT,
          ADD COLUMN IF NOT EXISTS message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          -- Índice de Engajamento Comercial: marca se uma mensagem fromMe=true foi
          -- provavelmente enviada por bot/saudação automática (resposta rápida demais
          -- após a última mensagem do lead) — calculada e gravada no momento do INSERT
          -- em webhook-evo.js, não recalculada na leitura das métricas.
          ADD COLUMN IF NOT EXISTS is_bot_reply BOOLEAN NOT NULL DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS idx_chat_messages_cliente_instance
          ON public.chat_messages(cliente_id, instance, message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_cliente_at
          ON public.chat_messages(cliente_id, message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
          ON public.chat_messages(cliente_id, instance, telefone, message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_cliente_phone_at
          ON public.chat_messages(cliente_id, telefone, message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_ttl
          ON public.chat_messages(message_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_dedup
          ON public.chat_messages(instance, message_id)
          WHERE message_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_leads_tracking_cliente_telefone_created
          ON public.leads_tracking(cliente_id, telefone, created_at DESC, id DESC);
      `);
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}
