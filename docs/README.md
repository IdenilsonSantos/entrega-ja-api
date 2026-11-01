# Documentação do Entrega Já

Plataforma de delivery com quatro perfis (cliente, loja, entregador e admin), dividida em três projetos:

| Projeto | O que é | Stack |
|---|---|---|
| [`entrega-ja-api`](https://github.com/IdenilsonSantos/entrega-ja-api) | Backend: pedidos, despacho, tempo real, notificações, e-mail, moderação | NestJS, PostgreSQL, Redis, BullMQ |
| [`entrega-ja-web`](https://github.com/IdenilsonSantos/entrega-ja-web) | Site dos quatro perfis (também instalável como PWA) | React, Vite, Tailwind, TanStack |
| [`entrega-ja-app`](https://github.com/IdenilsonSantos/entrega-ja-app) | App nativo do entregador | Expo, React Native |

## Documentos

1. [Visão geral](visao-geral.md): perfis, o que cada um faz e como subir tudo na máquina.
2. [Arquitetura](arquitetura.md): peças, como conversam e por que foram escolhidas.
3. [Fluxos](fluxos.md): pedido do começo ao fim, despacho, horário da loja, senha, convite, moderação.
4. [Operação](operacao.md): deploy, variáveis de ambiente, saúde, filas, limites, e-mail e problemas comuns.
5. [Testes](testes.md): testes automáticos, CI e roteiro de teste manual.

Os detalhes de cada projeto ficam no README dele: rotas da API, telas do site, recursos do app.

## Como é

| Cliente acompanha a entrega | Loja recebe no kanban |
|---|---|
| ![Acompanhamento](https://raw.githubusercontent.com/IdenilsonSantos/entrega-ja-web/main/docs/prints/acompanhamento.png) | ![Kanban](https://raw.githubusercontent.com/IdenilsonSantos/entrega-ja-web/main/docs/prints/kanban.png) |

| Admin vê a operação ao vivo | Entregador no app |
|---|---|
| ![Admin](https://raw.githubusercontent.com/IdenilsonSantos/entrega-ja-web/main/docs/prints/admin.png) | ![App](https://raw.githubusercontent.com/IdenilsonSantos/entrega-ja-app/main/docs/prints/corrida.png) |

Mais telas nos READMEs do [site](https://github.com/IdenilsonSantos/entrega-ja-web#telas) e do [app](https://github.com/IdenilsonSantos/entrega-ja-app#telas).
