// Fila de processamento assíncrono (BullMQ sobre Redis) — usada para tirar o
// webhook da Evolution do caminho síncrono de request/response. Sem REDIS_URL,
// a fila não é criada e o chamador deve processar inline (ver uso em webhook-evo.js).
import { Queue, Worker } from 'bullmq';

let connectionOpts = null;
if (process.env.REDIS_URL) {
  const url = new URL(process.env.REDIS_URL);
  connectionOpts = {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null, // exigido pelo BullMQ para conexões de worker/blocking
  };
}

export function isQueueEnabled() {
  return !!connectionOpts;
}

const queues = new Map();

export function getQueue(name) {
  if (!connectionOpts) return null;
  if (queues.has(name)) return queues.get(name);
  const queue = new Queue(name, {
    connection: connectionOpts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400 },
    },
  });
  queues.set(name, queue);
  return queue;
}

const workers = new Map();

/** Registra um worker para a fila (idempotente — não duplica se já registrado). */
export function registerWorker(name, processor, opts = {}) {
  if (!connectionOpts) return null;
  if (workers.has(name)) return workers.get(name);
  const worker = new Worker(name, processor, {
    connection: connectionOpts,
    concurrency: opts.concurrency || 5,
  });
  worker.on('failed', (job, err) => {
    console.error(`[queue:${name}] job ${job?.id} falhou:`, err.message);
  });
  workers.set(name, worker);
  return worker;
}
