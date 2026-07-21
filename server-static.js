// Servidor frontend-only para deploy separado no EasyPanel.
// Serve apenas HTML, CSS, JavaScript e imagens do painel.
// Não conecta no banco, não usa Redis, não expõe /api e não executa crons.
import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_BASE_URL = String(process.env.API_BASE_URL || '').replace(/\/+$/, '');
const PUBLIC_ROOT_FILES = new Set(['/index.html', '/login.html', '/share.html', '/wa-connect.html']);
const PUBLIC_DIRS = ['/css/', '/js/', '/img/'];

if (process.env.NODE_ENV === 'production' && !API_BASE_URL) {
  console.error('❌ FATAL: API_BASE_URL não configurada no serviço de frontend.');
  process.exit(1);
}

function runtimeConfigScript() {
  return `window.APP_CONFIG = Object.freeze({ API_BASE_URL: ${JSON.stringify(API_BASE_URL)} });\n`;
}

// Fallback: se algum HTML não carregar <script src="/runtime-config.js">
// explicitamente, ainda recebe a config injetada inline no <head>.
function injectRuntimeConfig(html) {
  const runtimeConfig = `<script>${runtimeConfigScript()}</script>`;
  return html.includes('</head>')
    ? html.replace('</head>', `  ${runtimeConfig}\n</head>`)
    : `${runtimeConfig}\n${html}`;
}

function sendStaticFile(req, res, filePath, publicPath, url) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (!stat?.isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  };

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
    ETag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  };

  const ifNoneMatch = String(req.headers['if-none-match'] || '');
  const ifModifiedSince = Date.parse(req.headers['if-modified-since'] || '');
  const fileMtimeSeconds = Math.floor(stat.mtimeMs / 1000) * 1000;
  const isFreshByEtag = ifNoneMatch.split(',').map(v => v.trim()).includes(headers.ETag);
  const isFreshByDate = !ifNoneMatch
    && Number.isFinite(ifModifiedSince)
    && ifModifiedSince >= fileMtimeSeconds;

  if (isFreshByEtag || isFreshByDate) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  // HTML precisa passar pela injeção de configuração de runtime.
  if (ext === '.html') {
    const html = injectRuntimeConfig(fs.readFileSync(filePath, 'utf8'));
    const acceptsGzip = (req.headers['accept-encoding'] || '').includes('gzip');
    headers.Vary = 'Accept-Encoding';

    if (acceptsGzip) {
      zlib.gzip(Buffer.from(html), (error, compressed) => {
        if (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Erro interno.');
          return;
        }
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        res.end(compressed);
      });
    } else {
      res.writeHead(200, headers);
      res.end(html);
    }
    return;
  }

  const isCompressible = ['.js', '.css', '.json', '.svg'].includes(ext);
  const acceptsGzip = (req.headers['accept-encoding'] || '').includes('gzip');
  if (isCompressible) headers.Vary = 'Accept-Encoding';

  if (isCompressible && acceptsGzip) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'frontend' }));
    return;
  }

  // Confirma a configuração ativa sem expor nenhum segredo.
  if (pathname === '/runtime-config.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(runtimeConfigScript());
    return;
  }

  let publicPath;
  try {
    publicPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  publicPath = publicPath.replace(/\\/g, '/');
  const isRootFile = PUBLIC_ROOT_FILES.has(publicPath);
  const isPublicAsset = PUBLIC_DIRS.some(dir => publicPath.startsWith(dir))
    && !publicPath.split('/').some(part => part.startsWith('.'));

  // Esse script precisa permanecer no domínio da API porque determina a origem
  // dos endpoints públicos a partir do próprio <script src>.
  if (publicPath === '/js/wapptrack.js') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // O frontend separado jamais deve responder rotas da API ou tracking.
  if (pathname.startsWith('/api/') || pathname.startsWith('/r/') || pathname.startsWith('/redirect/')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  if (!isRootFile && !isPublicAsset) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const filePath = path.resolve(__dirname, `.${publicPath}`);
  if (!filePath.startsWith(`${__dirname}${path.sep}`) && filePath !== path.join(__dirname, 'index.html')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  sendStaticFile(req, res, filePath, publicPath, url);
});

server.listen(PORT, () => {
  console.log(`✅ Frontend-only rodando em http://localhost:${PORT}`);
  console.log(`   API remota: ${API_BASE_URL || '(mesma origem, somente desenvolvimento)'}`);
});

function shutdown(signal) {
  console.log(`\n${signal} recebido - encerrando frontend...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
