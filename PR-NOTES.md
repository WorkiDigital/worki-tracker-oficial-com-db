# Notas da implementação

- `npm start`: mantém o serviço legado full-stack para rollback.
- `npm run start:api`: inicia somente API, tracking público, webhooks e crons.
- `npm run start:static`: inicia somente frontend estático.
- O frontend usa `API_BASE_URL` em runtime.
- PostgreSQL e Redis não foram alterados.
