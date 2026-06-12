// Simple local dev server — mirrors Vercel's /api routes
// Run: node server.js (needs .env in same folder)
import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'TOKEN_ENCRYPTION_KEY'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`❌ FATAL: ${key} não configurado. Servidor não pode iniciar.`);
        process.exit(1);
    }
}

const PORT = process.env.PORT || 3000;
const MAX_BODY_BYTES = parseInt(process.env.MAX_BODY_BYTES || `${2 * 1024 * 1024}`, 10);
const PUBLIC_ROOT_FILES = new Set(['/index.html', '/login.html', '/share.html']);
const PUBLIC_DIRS = ['/css/', '/js/', '/img/'];

async function callApiHandler(modulePath, req, res) {
    try {
        const mod = process.env.NODE_ENV === 'production'
            ? await import(modulePath)
            : await import(`${modulePath}?t=${Date.now()}`);

        await mod.default(req, res);
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: process.env.NODE_ENV === 'production' ? 'Erro interno.' : e.message }));
    }
}

// Wrap Node's IncomingMessage to look like Vercel's req
function wrapReq(req) {
    const url = new URL(req.url, `http://localhost`);
    req.query = Object.fromEntries(url.searchParams);
    req.body = {};
    return req;
}

function parseBody(req, res) {
    return new Promise((resolve) => {
        let data = '';
        let tooLarge = false;
        req.on('data', chunk => {
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
            try { req.body = data ? JSON.parse(data) : {}; } catch { req.body = {}; }
            resolve(false);
        });
        req.on('error', () => resolve(tooLarge));
    });
}

// Wrap ServerResponse to look like Vercel's res
function wrapRes(res) {
    res.status = (code) => { res.statusCode = code; return res; };
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

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;

    // Health check para EasyPanel / Docker
    if (pathname === '/health' || pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // Detailed health check — DB + Redis + uptime
    if (pathname === '/health/detailed') {
        const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
        const requiredToken = process.env.HEALTHCHECK_TOKEN;
        const isAllowed = process.env.NODE_ENV !== 'production'
            || process.env.EXPOSE_DETAILED_HEALTH === 'true'
            || (requiredToken && token === requiredToken);
        if (!isAllowed) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        const details = { status: 'ok', uptime: Math.round(process.uptime()), memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB', checks: {} };
        try {
            const { getPool } = await import('./api/_db.js');
            const pool = getPool();
            const t0 = Date.now();
            await pool.query('SELECT 1');
            details.checks.database = { status: 'ok', latencyMs: Date.now() - t0 };
        } catch (e) {
            details.status = 'degraded';
            details.checks.database = { status: 'error', error: e.message };
        }
        try {
            if (process.env.REDIS_URL) {
                const Redis = (await import('ioredis')).default;
                const r = new Redis(process.env.REDIS_URL, { connectTimeout: 3000, lazyConnect: true });
                const t0 = Date.now();
                await r.connect();
                await r.ping();
                details.checks.redis = { status: 'ok', latencyMs: Date.now() - t0 };
                r.disconnect();
            } else {
                details.checks.redis = { status: 'not_configured' };
            }
        } catch (e) {
            details.checks.redis = { status: 'error', error: e.message };
        }
        const code = details.status === 'ok' ? 200 : 503;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(details));
        return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
        const route = pathname.slice(5).replace(/\/$/, '') || 'index';
        let handlerPath = path.join(__dirname, 'api', route + '.js');
        const wrappedReq = wrapReq(req);
        const wrappedRes = wrapRes(res);

        // Suporte para rotas dinâmicas (ex: /api/logs/123 -> api/logs/[id].js)
        if (!fs.existsSync(handlerPath)) {
            const parts = route.split('/');
            if (parts.length >= 2) {
                const parentDir = path.join(__dirname, 'api', ...parts.slice(0, -1));
                const dynamicPath = path.join(parentDir, '[id].js');
                if (fs.existsSync(dynamicPath)) {
                    handlerPath = dynamicPath;
                    // Injeta o ID na query
                    wrappedReq.query.id = parts[parts.length - 1];
                }
            }
        }

        if (fs.existsSync(handlerPath)) {
            // Rate Limit para Webhooks (Proteção contra flooding)
            if (route.startsWith('webhook-')) {
                const { checkRateLimit } = await import('./middleware/rateLimit.js');
                const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
                if (checkRateLimit(ip, wrappedRes)) return;
            }

            if (await parseBody(wrappedReq, res)) return;
            return callApiHandler(pathToFileURL(handlerPath).href, wrappedReq, wrappedRes);
        }
        res.writeHead(404); res.end('Not found');
        return;
    }

    // Static files: only the public app shell and assets are exposed.
    let publicPath;
    try {
        publicPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
    } catch {
        res.writeHead(400); res.end('Bad request');
        return;
    }
    publicPath = publicPath.replace(/\\/g, '/');
    const isRootFile = PUBLIC_ROOT_FILES.has(publicPath);
    const isPublicAsset = PUBLIC_DIRS.some(dir => publicPath.startsWith(dir))
        && !publicPath.split('/').some(part => part.startsWith('.'));

    if (!isRootFile && !isPublicAsset) {
        res.writeHead(404); res.end('Not found');
        return;
    }

    const filePath = path.resolve(__dirname, `.${publicPath}`);
    if (!filePath.startsWith(__dirname + path.sep) && filePath !== path.join(__dirname, 'index.html')) {
        res.writeHead(404); res.end('Not found');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const types = {
            '.html':'text/html; charset=utf-8',
            '.js':'application/javascript; charset=utf-8',
            '.css':'text/css; charset=utf-8',
            '.json':'application/json; charset=utf-8',
            '.svg':'image/svg+xml',
            '.png':'image/png',
            '.jpg':'image/jpeg',
            '.jpeg':'image/jpeg',
            '.webp':'image/webp',
            '.ico':'image/x-icon',
        };
        res.writeHead(200, {
            'Content-Type': types[ext] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404); res.end('Not found');
    }
});

function pathToFileURL(p) { return new URL('file:///' + p.replace(/\\/g,'/')); }

server.listen(PORT, () => {
    console.log(`✅ Dev server running at http://localhost:${PORT}`);
    console.log(`   API routes: /api/leads, /api/config, /api/ads, /api/ads-accounts`);
    iniciarCronZap();
});

async function iniciarCronZap() {
    try {
        const { runCronJob } = await import('./api/cron/send-reports.js');
        const tick = async () => {
            try { await runCronJob(); }
            catch (e) { console.error('[CronZap]', e.message); }
        };
        setInterval(tick, 60_000);
        console.log('⏰ CronZap iniciado — verifica agendamentos a cada 60s');
    } catch (e) {
        console.error('[CronZap] Falha ao iniciar:', e.message);
    }
}

// ── Graceful shutdown (evita "npm error signal SIGTERM" no EasyPanel) ──
function shutdown(signal) {
    console.log(`\n⏹ ${signal} received — shutting down gracefully…`);
    server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
    });
    // Force exit after 5s if connections don't close
    setTimeout(() => { process.exit(0); }, 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
