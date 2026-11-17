// Executar com: node --test scripts/test-docs-routes.js
// Servidores locais isolados, sem credenciais reais, banco, Redis ou crons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));

async function availablePort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

for (const entry of ['server.js', 'server-static.js']) {
  test(`${entry}: publica a ajuda e bloqueia os documentos internos`, { timeout: 15000 }, async t => {
    const port = await availablePort();
    const child = spawn(process.execPath, [entry], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        DOTENV_CONFIG_PATH: path.join(os.tmpdir(), `adlytics-docs-test-no-env-${process.pid}`),
        DATABASE_URL: 'postgresql://docs:docs@127.0.0.1:1/docs_test_unused',
        JWT_SECRET: 'docs-route-test-only',
        TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
        ENABLE_CRONS: 'false',
        REDIS_URL: '',
        API_BASE_URL: '',
      },
    });
    t.after(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });

    await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`${entry} não iniciou a tempo`)), 7000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => {
        clearTimeout(timeout);
        reject(new Error(`${entry} encerrou antes da verificação (código ${code})`));
      });
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output.includes(`http://localhost:${port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.stderr.resume();
    });

    const get = route => fetch(`http://127.0.0.1:${port}${route}`);
    for (const route of ['/docs', '/docs/', '/docs/index.html']) {
      const response = await get(route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(await response.text(), /id="docSearchInput"/);
    }

    for (const route of [
      '/docs/documentacao_saas.md',
      '/docs/technical/cloud.md',
      '/docs/diag-leads.sql',
      '/docs/%64ocumentacao_saas.md',
      '/docs/..%2FCLAUDE.md',
    ]) {
      const response = await get(route);
      assert.equal(response.status, 404, `Arquivo interno exposto: ${route}`);
      await response.text();
    }

    for (const route of ['/login.html', '/css/dashboard-base.css', '/js/utils.js', '/img/logo_menu.png', '/health']) {
      const response = await get(route);
      assert.equal(response.status, 200, `Regressão na rota pública: ${route}`);
      await response.arrayBuffer();
    }
  });
}
