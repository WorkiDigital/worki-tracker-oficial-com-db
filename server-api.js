// Servidor API-only para deploy separado no EasyPanel.
// Expõe APIs, tracking público, wapptrack.js, health checks e crons.
// Não serve index.html, login.html, share.html, CSS, imagens ou JS do painel.
import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'TOKEN_ENCRYPTION_KEY'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ FATAL: ${key} não configurado. Servidor API não pode iniciar.`);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 3000;
const MAX_BODY_BYTES = Number.parseInt(
  process.env.MAX_BODY_BYTES || `${20 * 1024 * 1024}`,
  10
);

async function callApiHandler(modulePath, req, res) {
  try {
    const mod = process.env.NODE_ENV === 'production'
      ? await import(modulePath)
      : await import(`${modulePath}?t=${Date.now()}`);

    await mod.default(req, res);
  } catch (error) {
    console.error('[API] Erro não tratado:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({
        error: process.env.NODE_ENV === 'production' ? 'Erro interno.' : error.message
      }));
    }
  }
}

function wrapReq(req) {
  const url = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(url.searchParams);
  req.body = {};
  return req;
}

function parseBody(req, res) {
  return new Promise((resolve) => {
    let data = '';
    let tooLarge = false;

    req.on('data', (chunk) => {
      data += chunk;
      if (!tooLarge && Buffer.byteLength(data) > MAX_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload muito grande.' }));
        req.destroy();
        resolve(true);
      }
    });

    req.on('end', () => {
      if (tooLarge) return;
      try {
        req.body = data ? JSON.parse(data) : {};
      } catch {
        req.body = {};
      }
      resolve(false);
    });

    req.on('error', () => resolve(tooLarge));
  });
}

function wrapRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (data) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
    }
    res.end(JSON.stringify(data));
  };

  res.end = res.end.bind(res);
  return res;
}

function sendNotFound(res) {
  res.writeHead(404, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify({ error: 'Not found' }));
}

function serveWapptrack(req, res, pathname) {
  if (pathname !== '/js/wapptrack.js') return false;

  const filePath = path.join(__dirname, 'js', 'wapptrack.js');
  if (!fs.existsSync(filePath)) {
    sendNotFound(res);
    return true;
  }

  const stat = fs.statSync(filePath);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  if (String(req.headers['if-none-match'] || '').split(',').map(v => v.trim()).includes(etag)) {
    res.writeHead(304, {
      ETag: etag,
      'Cache-Control': 'public, max-age=300, must-revalidate'
    });
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=300, must-revalidate',
    'Last-Modified': stat.mtime.toUTCString(),
    ETag: etag
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'api' }));
    return;
  }

  if (pathname === '/health/detailed') {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
    const requiredToken = process.env.HEALTHCHECK_TOKEN;
    const isAllowed = process.env.NODE_ENV !== 'production'
      || process.env.EXPOSE_DETAILED_HEALTH === 'true'
      || (requiredToken && token === requiredToken);

    if (!isAllowed) {
      sendNotFound(res);
      return;
    }

    const details = {
      status: 'ok',
      service: 'api',
      uptime: Math.round(process.uptime()),
      memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      checks: {}
    };

    try {
      const { getPool } = await import('./api/_db.js');
      const t0 = Date.now();
      await getPool().query('SELECT 1');
      details.checks.database = { status: 'ok', latencyMs: Date.now() - t0 };
    } catch (error) {
      details.status = 'degraded';
      details.checks.database = { status: 'error', error: error.message };
    }

    try {
      if (process.env.REDIS_URL) {
        const Redis = (await import('ioredis')).default;
        const redis = new Redis(process.env.REDIS_URL, {
          connectTimeout: 3000,
          lazyConnect: true
        });
        const t0 = Date.now();
        await redis.connect();
        await redis.ping();
        details.checks.redis = { status: 'ok', latencyMs: Date.now() - t0 };
        redis.disconnect();
      } else {
        details.checks.redis = { status: 'not_configured' };
      }
    } catch (error) {
      details.status = 'degraded';
      details.checks.redis = { status: 'error', error: error.message };
    }

    res.writeHead(details.status === 'ok' ? 200 : 503, {
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify(details));
    return;
  }

  if (serveWapptrack(req, res, pathname)) return;

  if (pathname.startsWith('/redirect/') || pathname.startsWith('/r/')) {
    const isUuidRoute = pathname.startsWith('/redirect/');
    const prefixLength = isUuidRoute ? '/redirect/'.length : '/r/'.length;
    let slug;

    try {
      slug = decodeURIComponent(pathname.slice(prefixLength).replace(/\/$/, ''));
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Link inválido.');
      return;
    }

    const wrappedReq = wrapReq(req);
    const wrappedRes = wrapRes(res);
    wrappedReq.query.slug = slug;
    wrappedReq.query.public_path = isUuidRoute ? 'redirect' : 'r';

    try {
      const { checkRateLimit } = await import('./middleware/rateLimit.js');
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      if (await checkRateLimit(ip, wrappedRes)) return;
    } catch {
      // Rate limit best-effort, igual ao servidor legado.
    }

    return callApiHandler(
      pathToFileURL(path.join(__dirname, 'api', 'redirect.js')).href,
      wrappedReq,
      wrappedRes
    );
  }

  if (pathname.startsWith('/api/')) {
    const route = pathname.slice(5).replace(/\/$/, '') || 'index';
    let handlerPath = path.join(__dirname, 'api', `${route}.js`);
    const wrappedReq = wrapReq(req);
    const wrappedRes = wrapRes(res);

    if (!fs.existsSync(handlerPath)) {
      const parts = route.split('/');
      if (parts.length >= 2) {
        const parentDir = path.join(__dirname, 'api', ...parts.slice(0, -1));
        const dynamicPath = path.join(parentDir, '[id].js');
        if (fs.existsSync(dynamicPath)) {
          handlerPath = dynamicPath;
          wrappedReq.query.id = parts[parts.length - 1];
        }
      }
    }

    if (!fs.existsSync(handlerPath)) {
      sendNotFound(res);
      return;
    }

    if (route.startsWith('webhook-') || route === 'redirect') {
      const { checkRateLimit } = await import('./middleware/rateLimit.js');
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      if (await checkRateLimit(ip, wrappedRes)) return;
    }

    if (await parseBody(wrappedReq, res)) return;
    return callApiHandler(pathToFileURL(handlerPath).href, wrappedReq, wrappedRes);
  }

  sendNotFound(res);
});

server.listen(PORT, () => {
  console.log(`✅ API-only rodando em http://localhost:${PORT}`);
  console.log('   Rotas públicas: /api/*, /r/*, /redirect/*, /js/wapptrack.js');
  iniciarCronZap();
  iniciarCronChatCleanup();
});

async function iniciarCronZap() {
  try {
    const { runCronJob } = await import('./api/cron/send-reports.js');
    const tick = async () => {
      try {
        await runCronJob();
      } catch (error) {
        console.error('[CronZap]', error.message);
      }
    };
    setInterval(tick, 60_000);
    console.log('[CronZap] iniciado - verifica agendamentos a cada 60s');
  } catch (error) {
    console.error('[CronZap] Falha ao iniciar:', error.message);
  }
}

async function iniciarCronChatCleanup() {
  try {
    const { runChatCleanup } = await import('./api/cron/chat-cleanup.js');
    const tick = async () => {
      try {
        await runChatCleanup();
      } catch (error) {
        console.error('[ChatCleanup]', error.message);
      }
    };
    setInterval(tick, 60 * 60_000);
    tick();
    console.log('[ChatCleanup] iniciado - remove mensagens com mais de 15 dias a cada 1h');
  } catch (error) {
    console.error('[ChatCleanup] Falha ao iniciar:', error.message);
  }
}

function shutdown(signal) {
  console.log(`\n${signal} recebido - encerrando API...`);
  server.close(() => {
    console.log('Servidor HTTP da API encerrado');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
