// Servidor estático minimalista — serve só o front (HTML/CSS/JS/img).
// Não toca banco, não tem rotas /api, não roda crons. Usado quando front e
// API rodam em serviços/domínios separados (ver PLANO de separação front/API).
// Run: node server-static.js (só precisa da env PORT, opcional).
import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const PUBLIC_ROOT_FILES = new Set(['/index.html', '/login.html', '/share.html']);
const PUBLIC_DIRS = ['/css/', '/js/', '/img/'];

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;

    if (pathname === '/health' || pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

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

    // wapptrack.js roda em sites de TERCEIROS e resolve a própria API pelo
    // <script src>; precisa ser servido pelo domínio da API, não pelo front
    // (ver PLANO de separação front/API). Bloqueado aqui de propósito.
    if (publicPath === '/js/wapptrack.js') {
        res.writeHead(404); res.end('Not found');
        return;
    }

    if (!isRootFile && !isPublicAsset) {
        res.writeHead(404); res.end('Not found');
        return;
    }

    const filePath = path.resolve(__dirname, `.${publicPath}`);
    if (!filePath.startsWith(__dirname + path.sep) && filePath !== path.join(__dirname, 'index.html')) {
        res.writeHead(404); res.end('Not found');
        return;
    }

    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    if (stat?.isFile()) {
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

        // Mesma política de cache do server.js: shell do SPA nunca cacheado
        // (precisa refletir o deploy mais novo); demais assets ganham cache
        // longo só quando a requisição tem ?v= (senão fallback de 5 min).
        const isShell = PUBLIC_ROOT_FILES.has(publicPath);
        const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.ico'].includes(ext);
        let cacheControl;
        if (isShell) {
            cacheControl = 'no-cache';
        } else if (isImage) {
            cacheControl = 'public, max-age=86400';
        } else if (url.searchParams.has('v')) {
            cacheControl = 'public, max-age=31536000, immutable';
        } else {
            cacheControl = 'public, max-age=300';
        }

        const headers = {
            'Content-Type': types[ext] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Cache-Control': cacheControl,
            'Last-Modified': stat.mtime.toUTCString(),
            'ETag': `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
        };

        const isCompressible = ['.html', '.js', '.css', '.json', '.svg'].includes(ext);
        const acceptsGzip = (req.headers['accept-encoding'] || '').includes('gzip');
        if (isCompressible) headers['Vary'] = 'Accept-Encoding';

        const ifNoneMatch = String(req.headers['if-none-match'] || '');
        const ifModifiedSince = Date.parse(req.headers['if-modified-since'] || '');
        const fileMtimeSeconds = Math.floor(stat.mtimeMs / 1000) * 1000;
        const isFreshByEtag = ifNoneMatch.split(',').map(v => v.trim()).includes(headers.ETag);
        const isFreshByDate = !ifNoneMatch && Number.isFinite(ifModifiedSince) && ifModifiedSince >= fileMtimeSeconds;
        if (isFreshByEtag || isFreshByDate) {
            res.writeHead(304, headers);
            res.end();
            return;
        }

        if (isCompressible && acceptsGzip) {
            headers['Content-Encoding'] = 'gzip';
            res.writeHead(200, headers);
            fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
        } else {
            res.writeHead(200, headers);
            fs.createReadStream(filePath).pipe(res);
        }
    } else {
        res.writeHead(404); res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`✅ Front (estático) rodando em http://localhost:${PORT}`);
});
