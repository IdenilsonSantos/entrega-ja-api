# Entrega Já · API

Backend da plataforma de delivery: pedidos, despacho automático de entregadores, tempo real,
notificações (central, web push e push no celular), lojas com equipe e moderação.

**Stack:** NestJS 11 · TypeORM · PostgreSQL 16 · Redis 7 (GEO, pub/sub, Streams) · BullMQ · SSE

Projetos relacionados: `entrega-ja-web` (site) e `entrega-ja-app` (app do entregador).

## Rodar

Com Docker (Postgres, Redis, migrations, seed, API e worker):

```bash
docker compose up --build
# API em http://localhost:3000/api
```

Sem Docker (Postgres e Redis locais):

```bash
cp .env.example .env    # ajuste se precisar
npm install
npm run build
SEED_DEMO_HISTORY=true npm run seed   # migrations + dados de demonstração
npm run dev                           # APP_ROLE=all: API e worker no mesmo processo
```

Contas de demonstração (senha `123456`):

| Conta | Papel |
|---|---|
| `admin@demo.com` | Admin da plataforma |
| `cliente@demo.com`, `bruno@demo.com` | Clientes |
| `loja@demo.com` | Dono do Burger da Vila e do Sushi Paulista |
| `gerente@demo.com` | Gerente do Burger da Vila |
| `atendente@demo.com` | Atendente nas duas lojas do Lucas |
| `loja2@demo.com` | Dona da Pizzaria Bella e do Açaí do Parque (em análise) |
| `entregador1..3@demo.com` | Entregadores aprovados |
| `entregador4@demo.com` | Entregador em análise |

## Testes

```bash
# API rodando com ofertas curtas para o teste não demorar
DISPATCH_OFFER_TTL_SEC=6 DISPATCH_RETRY_DELAY_MS=1500 DISPATCH_ALERT_AFTER=3 npm start
API=http://localhost:3000/api npm run test:e2e
```

O teste (`test/e2e.mjs`) cobre ponta a ponta o pedido com despacho, a atribuição manual,
a equipe e as permissões, o perfil do entregador, a moderação e o push. Ele altera o banco:
use um banco de teste.

## Organização

```
src/
  main.ts, app.module.ts, config.ts, seed.ts
  common/          auth (guard, @Roles, @Public), paginação por cursor, erros, geo
  infra/
    database/      data-source, entidades, migrations
    redis/         conexões
    queue/         filas BullMQ (dispatch, push)
    events/        tempo real: SSE + Redis Streams/pub-sub
    storage/       fotos (sharp → WebP)
  modules/
    auth/          cadastro, login, minha conta, senha, foto
    users/         entidade de conta e papéis
    couriers/      perfil e veículo, turno (online), localização, ofertas, entregas, ganhos
    addresses/     endereços da cliente
    stores/        vitrine pública (lojas perto, cardápio)
    merchant/      lojas do lojista, equipe e convites, permissões
    catalog/       cardápio (seções, produtos, opções)
    orders/        ciclo do pedido, visões por perfil, linha do tempo
    dispatch/      busca de entregador, presença (Redis GEO), atribuição manual
    notifications/ central, web push (VAPID) e push do Expo
    moderation/    denúncias e auditoria
    admin/         painel da plataforma
    settings/      regras ajustáveis (comissão, pagamento do entregador, raio)
    events/, health/
```

## Papéis e permissões

| Papel | Pode |
|---|---|
| `CUSTOMER` | Ver lojas, pedir, acompanhar, avaliar, denunciar |
| `COURIER` | Editar perfil e veículo, ficar online, aceitar corridas, retirar e entregar. Começa **em análise** até o admin aprovar |
| `MERCHANT` | Trabalhar nas lojas em que está na equipe, com o papel de cada loja (abaixo) |
| `ADMIN` | Acesso total e moderação: aprovar, suspender, bloquear, tirar produto do ar, tratar denúncias, cancelar e atribuir pedidos, mudar regras |

Na loja (`store_members`), as rotas checam **permissões**, não papéis:

| Permissão | Dono | Gerente | Atendente |
|---|:-:|:-:|:-:|
| Pedidos, abrir e fechar a loja | ✓ | ✓ | ✓ |
| Marcar produto esgotado | ✓ | ✓ | ✓ |
| Editar cardápio | ✓ | ✓ | |
| Editar dados da loja | ✓ | ✓ | |
| Relatórios | ✓ | ✓ | |
| Equipe | todos | só atendentes | |
| Transferir a loja | ✓ | | |

Um lojista pode ter várias lojas e participar da equipe de outras. Convites vão por link
(`/convite/<token>`, válido por 7 dias): quem não tem conta se cadastra pelo link e já entra na
equipe; quem tem conta de lojista recebe o convite na central de notificações.

## Ciclo do pedido

```
PENDING ─loja aceita→ PREPARING ─loja marca pronto→ READY ─retira→ PICKED_UP ─código→ DELIVERED
   ├─loja recusa→ REJECTED
   └─cliente cancela→ CANCELLED      (loja cancela em PREPARING/READY; admin em qualquer etapa ativa)
```

- **A busca por entregador só começa em `READY`.** A comida já está pronta quando ele chega.
- **A cliente só vê a entrega (entregador, veículo, posição) a partir de `READY`.** Se o admin
  designar alguém durante o preparo, a cliente continua sem ver até ficar pronto.
- O preço é sempre calculado no servidor com o cardápio atual; o pedido guarda uma cópia dos itens.
- A entrega só é confirmada com o código de 4 dígitos que a cliente vê no app.
- Toda mudança vai para a linha do tempo do pedido (`order_events`).

## Despacho

1. Pedido em `READY`: entra na fila `dispatch`.
2. O worker busca entregadores online perto da loja (`GEOSEARCH`), livres, aprovados e que
   ainda não recusaram. O mais perto recebe a oferta por SSE e push com prioridade alta.
3. A oferta vale `DISPATCH_OFFER_TTL_SEC`. Recusou ou expirou: vai para o próximo.
4. Sem ninguém: tenta de novo a cada `DISPATCH_RETRY_DELAY_MS`. Depois de `DISPATCH_ALERT_AFTER`
   rodadas, os admins são avisados.
5. O admin pode atribuir (ou trocar) o entregador a qualquer momento antes da retirada:
   `GET /admin/orders/:id/couriers` lista todos os aprovados, com online, ocupado e distância.

## Notificações

Cada aviso (`NotificationsService.notify`):
1. fica salvo na central (`notifications`, com lido/não lido);
2. chega na hora pelo SSE (`event: notification`);
3. vira push, pela fila `push` processada no worker:
   - **navegador:** Web Push com VAPID. Sem chaves no ambiente, um par é gerado e guardado no
     Redis, igual para todas as réplicas. Inscrições mortas (404/410) são apagadas;
   - **celular:** API de push do Expo, com o token que o app registra. Ofertas usam o canal
     `offers` com prioridade alta.

## Tempo real

`GET /api/events/stream` (SSE, header `Authorization` ou `?token=`).

| Evento | Para | Quando |
|---|---|---|
| `notification`, `notification.read` | a pessoa | aviso novo, lidos |
| `order.updated` | cliente, equipe da loja, entregador, admins | qualquer mudança no pedido (cada um recebe a sua visão) |
| `offer.new`, `offer.expired`, `offer.cancelled` | entregador | ofertas de corrida |
| `courier.location` | cliente | posição do entregador (a partir de `READY`) |
| `fleet.location` | admins | mapa ao vivo |
| `session.revoked` | a pessoa | conta bloqueada |

Os eventos ficam num Redis Stream por pessoa; ao reconectar com `Last-Event-ID`, a API reenvia o
que se perdeu. Funciona com várias réplicas (pub/sub entre elas).

## Rotas

Todas sob `/api`. Listas usam paginação por cursor: `?limit=20&cursor=…` → `{ items, nextCursor }`.

| Área | Rotas |
|---|---|
| Conta | `POST /auth/register`, `POST /auth/login`, `GET/PATCH /me`, `POST /me/password`, `POST /me/avatar` |
| Vitrine | `GET /stores?lat&lng&q&category`, `GET /stores/categories`, `GET /stores/:id` |
| Endereços | `GET/POST /addresses`, `PUT/DELETE /addresses/:id` |
| Pedidos (cliente) | `POST /orders`, `GET /orders?scope=active\|history`, `GET /orders/:id`, `GET /orders/:id/tracking`, `POST /orders/:id/cancel`, `POST /orders/:id/rate` |
| Lojista | `GET/POST /merchant/stores`, `GET/PATCH /merchant/stores/:id`, `POST …/open`, `POST …/logo`, `POST …/cover`, `GET …/stats` |
| Equipe | `GET …/team`, `POST …/invites`, `DELETE …/invites/:id`, `PATCH/DELETE …/members/:id`, `POST …/members/:id/transfer-ownership`, `GET /invites/:token`, `POST /invites/:token/accept` |
| Cardápio | `GET …/menu`, `POST …/categories`, `PUT …/categories/order`, `PATCH/DELETE …/categories/:id`, `POST …/products`, `PUT …/products/order`, `PUT/DELETE …/products/:id`, `POST …/products/:id/availability`, `POST …/products/:id/photo` |
| Pedidos (loja) | `GET /merchant/stores/:id/orders`, `GET /merchant/orders/:id`, `POST /merchant/orders/:id/accept\|reject\|ready\|cancel` |
| Entregador | `GET/PATCH /courier/profile`, `GET /courier/status`, `POST /courier/presence`, `POST /courier/location`, `POST /courier/offers/:id/accept\|decline`, `POST /courier/orders/:id/pickup\|deliver\|drop`, `GET /courier/deliveries`, `GET /courier/earnings` |
| Notificações | `GET /notifications?unread`, `GET /notifications/unread-count`, `POST /notifications/read`, `GET /push/vapid-key`, `POST/DELETE /push/subscriptions`, `POST /push/devices`, `DELETE /push/devices/:token`, `POST /push/test` |
| Denúncias | `POST /reports` |
| Admin | `GET /admin/overview`, `GET /admin/fleet`, `GET /admin/approvals`, `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/:id/approve\|request-changes\|block\|unblock`, `GET /admin/stores`, `GET /admin/stores/:id`, `POST /admin/stores/:id/approve\|suspend\|reactivate`, `POST /admin/products/:id/remove\|restore`, `GET /admin/orders`, `GET /admin/orders/:id`, `POST /admin/orders/:id/cancel`, `GET /admin/orders/:id/couriers`, `POST /admin/orders/:id/assign\|unassign`, `GET /admin/reports`, `POST /admin/reports/:id/resolve`, `GET /admin/audit`, `GET/PUT /admin/settings` |
| Saúde | `GET /health` |

## Banco

O esquema é versionado em `src/infra/database/migrations`. Depois de mudar uma entidade:

```bash
npm run migration:generate --name=DescricaoDaMudanca
```

`npm run seed` (ou `node dist/seed.js` no container) aplica as migrations que faltam e, com o
banco vazio, cria os dados de demonstração.

## Deploy (Railway)

- Serviço **api**: Config file `railway.json` (pre-deploy `node dist/seed.js`, healthcheck
  `/api/health`), gere um domínio, volume em `/data/uploads` e `RAILWAY_RUN_UID=0`.
- Serviço **worker**: o mesmo repositório com `railway.worker.json` e `APP_ROLE=worker`.
- Postgres e Redis do Railway: `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
  `REDIS_URL=${{Redis.REDIS_URL}}`.
- `JWT_SECRET` forte, e `CORS_ORIGIN`/`APP_URL` com o endereço do site.

Todas as variáveis estão em [`.env.example`](.env.example).
