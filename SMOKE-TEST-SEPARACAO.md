# Smoke test — separação frontend/API

## API-only

```bash
NODE_ENV=production \
DATABASE_URL='postgresql://...' \
REDIS_URL='redis://...' \
JWT_SECRET='...' \
TOKEN_ENCRYPTION_KEY='...' \
ALLOWED_ORIGINS='http://localhost:3001' \
PORT=3000 \
npm run start:api
```

Validar:

```bash
curl -i http://localhost:3000/health
curl -i http://localhost:3000/
curl -i http://localhost:3000/index.html
curl -i http://localhost:3000/js/wapptrack.js
curl -i -X OPTIONS http://localhost:3000/api/config \
  -H 'Origin: http://localhost:3001' \
  -H 'Access-Control-Request-Method: GET'
```

Resultados esperados:

- `/health`: 200 e `service=api`.
- `/`: 404.
- `/index.html`: 404.
- `/js/wapptrack.js`: 200.
- `OPTIONS /api/config`: resposta CORS do handler.

## Frontend-only

```bash
NODE_ENV=production \
API_BASE_URL='http://localhost:3000' \
PORT=3001 \
npm run start:static
```

Validar:

```bash
curl -i http://localhost:3001/health
curl -i http://localhost:3001/
curl -i http://localhost:3001/runtime-config.js
curl -i http://localhost:3001/api/config
curl -i http://localhost:3001/js/wapptrack.js
```

Resultados esperados:

- `/health`: 200 e `service=frontend`.
- `/`: 200 e HTML contendo `window.API_BASE_URL="http://localhost:3000"`.
- `/runtime-config.js`: 200 com a URL pública da API.
- `/api/config`: 404.
- `/js/wapptrack.js`: 404.

## Navegador

1. Abrir `http://localhost:3001/login.html`.
2. Confirmar no Network que `/api/config` é solicitado em `http://localhost:3000`.
3. Fazer login.
4. Confirmar que o header `Authorization` é enviado à API.
5. Abrir dashboard, leads, Kanban, relatórios e configurações.
6. Confirmar ausência de erros CORS no console.
