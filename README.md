# Entrega Já · API

Backend da plataforma de delivery: pedidos, despacho automático de entregadores, tempo real,
notificações (central, web push e push no celular), lojas com equipe e horário de funcionamento,
recuperação de senha por e-mail, limite de requisições e moderação.

**Stack:** NestJS 11 · TypeORM · PostgreSQL 16 · Redis 7 (GEO, pub/sub, Streams) · BullMQ · SSE

Projetos relacionados: `entrega-ja-web` (site) e `entrega-ja-app` (app do entregador).

## Rodar

Com Docker (Postgres, Redis, Mailpit, migrations, seed, API e worker):

```bash
docker compose up --build
# API em http://localhost:3000/api
# E-mails enviados (recuperação de senha) em http://localhost:8025
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
npm run build && npm run test:unit   # regras puras (horário de funcionamento)

# ponta a ponta: API com ofertas curtas e e-mail indo para o Mailpit (docker compose up -d mailpit)
DISPATCH_OFFER_TTL_SEC=6 DISPATCH_RETRY_DELAY_MS=1500 DISPATCH_ALERT_AFTER=3 PREP_MINUTE_MS=200 \
  MAIL_PROVIDER=smtp SMTP_URL=smtp://localhost:1025 npm start
API=http://localhost:3000/api npm run test:e2e
```

O teste (`test/e2e.mjs`) cobre ponta a ponta o pedido com despacho, a atribuição manual,
a equipe e as permissões, o perfil do entregador, a moderação, o push, o horário de funcionamento,
a saúde, o limite de requisições e a recuperação de senha (lendo o e-mail no Mailpit). Ele altera
o banco e usa os limites de login: rode num banco e num Redis de teste.

No GitHub, o workflow `CI` roda o build, os testes de unidade e o ponta a ponta com Postgres,
Redis e Mailpit a cada push e pull request.

## Organização

```
src/
  main.ts, app.module.ts, config.ts, seed.ts
  common/          auth (guard, @Roles, @Public), limite de requisições, paginação por cursor, erros, geo
  infra/
    database/      data-source, entidades, migrations
    redis/         conexões
    queue/         filas BullMQ (dispatch, push)
    events/        tempo real: SSE + Redis Streams/pub-sub
    storage/       fotos (sharp → WebP)
    mail/          e-mail pela fila (log, Resend ou SMTP)
  modules/
    auth/          cadastro, login, minha conta, senha, foto
    users/         entidade de conta e papéis
    couriers/      perfil e veículo, turno (online), localização, ofertas, entregas, ganhos
    addresses/     endereços da cliente
    stores/        vitrine pública (lojas perto, cardápio), horário de funcionamento
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

## Horário de funcionamento

Em **Loja → Dados** (`PATCH /merchant/stores/:id` com `openingHours` e `timezone`), cada loja define
faixas por dia da semana (`{ day: 0..6, open: "HH:MM", close: "HH:MM" }`, 0 = domingo), no fuso
da loja (padrão `America/Sao_Paulo`):

- um dia pode ter várias faixas (almoço e jantar);
- fechamento menor que a abertura passa da meia-noite (`18:00`–`02:00`); `00:00`–`00:00` é o dia todo;
- `openingHours: null` tira o horário e volta a valer só o botão.

A loja recebe pedidos quando **o botão está ligado e está dentro do horário**. Com horário, o dono
deixa o botão ligado e a loja abre e fecha sozinha; desligar o botão pausa no meio do expediente.
A vitrine devolve `openNow`, `opensAt` (fechada pelo horário) e `closesAt` (aberta pelo horário);
lojas fechadas vão para o fim da lista. A regra fica em `stores/opening-hours.ts`.

## Automação da loja

Cada loja pode ligar, em **Loja → Automação** (`PATCH /merchant/stores/:id`):

- `autoAccept`: pedido novo entra direto em `PREPARING` (a equipe recebe o aviso do mesmo jeito).
- `autoReady`: ao aceitar, um trabalho na fila `orders` é agendado para o fim do `prepTimeMin`;
  se ninguém marcou pronto antes, o pedido vira `READY` e a busca do entregador começa.

Retirada e entrega sempre andam sozinhas (quem confirma é o entregador). Na linha do tempo,
o que foi automático aparece sem autor e com a nota "Automático".

## Despacho

1. Pedido em `READY`: entra na fila `dispatch`.
2. O worker busca entregadores online perto da loja (`GEOSEARCH`), livres, aprovados e que
   ainda não recusaram. O mais perto recebe a oferta por SSE e push com prioridade alta.
3. A oferta vale `DISPATCH_OFFER_TTL_SEC`. Recusou ou expirou: vai para o próximo.
4. Sem ninguém: tenta de novo a cada `DISPATCH_RETRY_DELAY_MS`. Depois de `DISPATCH_ALERT_AFTER`
   rodadas, os admins são avisados.
5. O admin pode atribuir (ou trocar) o entregador a qualquer momento antes da retirada:
   `GET /admin/orders/:id/couriers` lista todos os aprovados, com online, ocupado e distância.

## Online do entregador

O entregador escolhe ficar online uma vez; a escolha fica salva (`courier_profiles.wantsOnline`).
`GET /courier/status` devolve `wantsOnline: true` e o app liga sozinho ao abrir, só mandando a
localização. Se o sinal cair e a presença expirar, a próxima localização o coloca online de novo.
Ele só sai quando escolhe ficar offline (ou quando a moderação bloqueia a conta).

## Rotas

`GET /routes?from=lat,lng&to=lat,lng&profile=driving|cycling|walking` devolve o melhor caminho
pelas ruas (`coordinates` em `[lat, lng]`, `distanceKm`, `durationMin`). O site e o app desenham
essa linha (animada) do entregador até a loja ou a cliente e mostram a previsão de chegada.

- Provedor por variável: `ROUTING_PROVIDER=osrm` (padrão) com `ROUTING_URL`, ou `mapbox` com
  `MAPBOX_TOKEN`. O OSRM público (`router.project-osrm.org`) é só para testes: em produção use um
  OSRM próprio (imagem `osrm/osrm-backend` com o mapa do Brasil do Geofabrik) ou o Mapbox.
- Rotas ficam 10 min em cache no Redis (pontos arredondados em ~11 m).
- Se o provedor falhar, a resposta vem em linha reta com tempo estimado (`source: "straight"`).

## Recuperação de senha

1. `POST /auth/forgot-password { email }` responde sempre `202` com a mesma mensagem, exista a conta
   ou não. Se existir (e não estiver bloqueada), um link `APP_URL/redefinir-senha/<token>` vai por e-mail.
2. O token só aparece no e-mail; no Redis fica o hash dele, com validade de `PASSWORD_RESET_TTL_MIN`
   (60 min). Pedir de novo invalida o link anterior.
3. `GET /auth/reset-password/:token` confere o link e devolve o e-mail mascarado (`cl•••••@demo.com`).
4. `POST /auth/reset-password { token, password }` troca a senha, derruba todas as sessões, já devolve
   uma sessão nova e manda um aviso de "senha alterada". O link vale uma vez só.

## E-mail

Os e-mails entram na fila `mail` e o worker envia (até 5 tentativas com espera crescente).
O provedor é escolhido por variável, sem mudar código:

| `MAIL_PROVIDER` | Uso | Variáveis |
|---|---|---|
| `log` (padrão) | só escreve no console | |
| `resend` | API do Resend (desenvolvimento) | `RESEND_API_KEY` |
| `smtp` | qualquer provedor com SMTP: SES, SendGrid, Postmark, Brevo (produção); Mailpit (local e CI) | `SMTP_URL` |

`MAIL_FROM` define o remetente (o domínio precisa estar verificado no provedor).

## Limite de requisições

Guard global com janela fixa no Redis, então o limite vale somado entre as réplicas. Passou do
limite: `429` com `Retry-After` e a mensagem "Muitas tentativas. Tente de novo em X min".

| Rota | Limite |
|---|---|
| Todas | `RATE_LIMIT_PER_MIN` (600) por IP por minuto |
| `POST /auth/login` | 10 por conta e 50 por IP a cada 15 min (força bruta) |
| `POST /auth/register` | 10 por IP por hora |
| `POST /auth/forgot-password` | 3 por e-mail por hora e 10 por IP a cada 15 min |
| `/auth/reset-password` | 20 por IP a cada 15 min |

`/health` fica fora. Se o Redis cair, as requisições passam (melhor que derrubar a API).
`RATE_LIMIT_ENABLED=false` desliga tudo.

## Saúde

| Rota | Para que serve |
|---|---|
| `GET /health/live` | o processo responde (liveness); não olha dependências, para não reiniciar à toa |
| `GET /health` | pronto para atender (readiness, usado no deploy): `503` se o banco ou o Redis cair |

`/health` também mostra os workers vivos (`workers.alive`, por batimento no Redis a cada 10 s) e o
tamanho de cada fila (`queues`). Worker parado não tira a API do ar, mas aparece como `alive: 0` e as
filas acumulam: vale um alerta no monitoramento.

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
| Conta | `POST /auth/register`, `POST /auth/login`, `POST /auth/forgot-password`, `GET /auth/reset-password/:token`, `POST /auth/reset-password`, `GET/PATCH /me`, `POST /me/password`, `POST /me/avatar` |
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
| Saúde | `GET /health`, `GET /health/live` |

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
- E-mail: `MAIL_PROVIDER=smtp`, `SMTP_URL` do provedor de produção e `MAIL_FROM` com domínio verificado,
  nos dois serviços (quem envia é o worker).

Todas as variáveis estão em [`.env.example`](.env.example).
