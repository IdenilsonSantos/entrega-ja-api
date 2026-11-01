# Operação

## Deploy

| Projeto | Onde | Como |
|---|---|---|
| API | Railway, serviço **api** | Config `railway.json` (pre-deploy `node dist/seed.js` aplica as migrations, healthcheck `/api/health`), volume em `/data/uploads`, `RAILWAY_RUN_UID=0` |
| Worker | Railway, serviço **worker** | Mesmo repositório com `railway.worker.json` e `APP_ROLE=worker` |
| Banco e Redis | Railway | `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}` |
| Site | Vercel | Framework Vite, `VITE_API_URL` apontando para a API. O `vercel.json` cuida das rotas e do cache |
| App | EAS | `eas build` com `EXPO_PUBLIC_API_URL` no perfil de produção e o `projectId` no `app.json` |

## Variáveis da API

Todas têm padrão para desenvolvimento ([`.env.example`](../.env.example)). Em produção, revise estas:

| Variável | Produção |
|---|---|
| `JWT_SECRET` | Texto longo e aleatório (trocar derruba todas as sessões) |
| `CORS_ORIGIN` | Endereço(s) do site, separados por vírgula |
| `APP_URL` | Endereço do site (vai nos links de convite e de redefinir senha) |
| `MAIL_PROVIDER`, `SMTP_URL` ou `RESEND_API_KEY`, `MAIL_FROM` | E-mail de verdade, com domínio verificado no provedor. **Nos dois serviços**: quem envia é o worker |
| `ROUTING_PROVIDER`, `ROUTING_URL` / `MAPBOX_TOKEN` | OSRM próprio ou Mapbox. O OSRM público é só para testes |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Fixe as chaves (trocar invalida as inscrições de push) |
| `EXPO_ACCESS_TOKEN` | Push do app, se o projeto Expo exigir token |
| `RATE_LIMIT_PER_MIN` | Limite geral por IP; ajuste se muitos usuários saem pelo mesmo IP |

No site, `VITE_DEMO_TOOLS` e no app `EXPO_PUBLIC_DEMO_TOOLS` ficam **vazios** em produção (tiram
o simulador e as contas de teste do pacote).

## E-mail

| Ambiente | Provedor |
|---|---|
| Local e CI | `smtp` com o Mailpit do docker compose (`smtp://mailpit:1025`); caixa em http://localhost:8025 |
| Desenvolvimento (servidor) | `resend` com `RESEND_API_KEY` |
| Produção | `smtp` com o provedor escolhido (SES, SendGrid, Postmark, Brevo…): trocar de provedor é só trocar o `SMTP_URL` |

Falha do provedor não perde o e-mail: a fila tenta de novo até 5 vezes, com espera crescente.

## Saúde e monitoramento

| Rota | Uso |
|---|---|
| `GET /api/health/live` | Liveness: o processo responde. Não olha dependências |
| `GET /api/health` | Readiness: `503` se o banco ou o Redis cair. Mostra workers vivos e o tamanho de cada fila |

Alertas que valem a pena:

- `/api/health` diferente de 200;
- `workers.alive` igual a 0 (despacho, push e e-mail param);
- `queues.dispatch.waiting` ou `queues.mail.failed` crescendo;
- aviso "Pedido sem entregador" chegando aos admins com frequência (falta de entregadores na região).

## Limite de requisições

Janela fixa no Redis, somada entre réplicas. Geral: `RATE_LIMIT_PER_MIN` por IP. Login: 10 por
conta e 50 por IP a cada 15 min. Cadastro: 10 por IP por hora. Esqueci a senha: 3 por e-mail por
hora. Passou: `429` com `Retry-After`. `/health` fica fora. Se o Redis cair, as requisições passam.

## Banco

Mudou uma entidade: `npm run migration:generate --name=DescricaoDaMudanca` (no Windows, gere pelo
`npx typeorm-ts-node-commonjs migration:generate -d src/infra/database/data-source.ts src/infra/database/migrations/Nome`).
O deploy aplica as migrations pendentes antes de subir a API.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Pedido pronto e nenhum entregador recebe oferta | Worker parado (`workers.alive: 0`) ou ninguém online no raio (`dispatchRadiusKm` em Regras) |
| Link de convite ou de senha aponta para `localhost` | `APP_URL` não configurado na API |
| E-mail não chega | `MAIL_PROVIDER=log` (só console), domínio do `MAIL_FROM` não verificado, ou worker sem as variáveis de e-mail |
| Push parou de chegar depois do deploy | Chaves VAPID mudaram: fixe `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` |
| Site dá erro de CORS | Endereço do site fora de `CORS_ORIGIN` |
| Muitos `429` num escritório | Todos saem pelo mesmo IP: aumente `RATE_LIMIT_PER_MIN` |
| Entregador "some" do mapa | Presença expira sem posição por `COURIER_PRESENCE_TTL_SEC`; a próxima posição o coloca online de novo |
