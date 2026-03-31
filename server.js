// Simple local dev server — mirrors Vercel's /api routes
// Run: node server.js (needs .env in same folder)
import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

async function callApiHandler(modulePath, req, res) {
    try {
        const mod = await import(`${modulePath}?t=${Date.now()}`);
        await mod.default(req, res);
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
}

// Wrap Node's IncomingMessage to look like Vercel's req
function wrapReq(req) {
    const url = new URL(req.url, `http://localhost`);
    req.query = Object.fromEntries(url.searchParams);
    req.body = {};
    return req;
}

function parseBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => {
            try { req.body = data ? JSON.parse(data) : {}; } catch { req.body = {}; }
            resolve();
        });
    });
}

// Wrap ServerResponse to look like Vercel's res
function wrapRes(res) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => {
        if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
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

    // API routes
    if (pathname.startsWith('/api/')) {
        const route = pathname.slice(5).replace(/\/$/, '') || 'index';
        const handlerPath = path.join(__dirname, 'handlers', route + '.js');
        if (fs.existsSync(handlerPath)) {
            const wrappedReq = wrapReq(req);
            await parseBody(wrappedReq);
            return callApiHandler(pathToFileURL(handlerPath).href, wrappedReq, wrapRes(res));
        }
        res.writeHead(404); res.end('Not found');
        return;
    }

    // Static files
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404); res.end('Not found');
    }
});

function pathToFileURL(p) { return new URL('file:///' + p.replace(/\\/g,'/')); }

server.listen(PORT, () => {
    console.log(`✅ Dev server running at http://localhost:${PORT}`);
    console.log(`   API routes: /api/leads, /api/config, /api/ads, /api/ads-accounts`);
});
