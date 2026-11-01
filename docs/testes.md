# Testes

## Automáticos

| Projeto | Comando | O que cobre |
|---|---|---|
| API | `npm run build && npm run test:unit` | Regras puras: horário de funcionamento (meia-noite, virada da semana, turnos, fuso, 24 h) |
| API | `npm run test:e2e` | Ponta a ponta contra a API rodando: pedido com despacho, oferta única, atribuição manual, equipe e permissões, automação do kanban, perfil do entregador, moderação, rotas, push, horário, saúde, limite de requisições e recuperação de senha lendo o e-mail no Mailpit |
| Site | `npm run build` | Checagem de tipos e build |
| App | `npm run typecheck && npm run export:web` | Checagem de tipos e bundle |

O e2e altera o banco e usa os limites de login: rode com banco e Redis de teste. Como subir a API
para ele está no [README da API](../README.md#testes).

## CI

Cada repositório tem o workflow `CI` (GitHub Actions), a cada push no `main` e em pull requests:

- **API:** Postgres, Redis e Mailpit como serviços; build, testes de unidade, seed e ponta a ponta.
- **Site:** checagem de tipos e build.
- **App:** checagem de tipos e export web.

## Roteiro manual (navegador)

O que foi verificado no navegador, no computador e no celular (390 px), com os quatro perfis em
janelas separadas:

| Área | Verificações |
|---|---|
| Cliente | vitrine e busca; categorias só com lojas no endereço; abas do cardápio seguem a rolagem; produto com opções obrigatórias; sacola com pedido mínimo; pedido com Pix; acompanhamento em tempo real e no mapa; código de entrega; avaliação; cancelamento antes da loja aceitar; endereço novo; troca de senha; denúncia; central de notificações; cadastro |
| Loja | kanban em tempo real; aceitar, recusar com motivo, marcar pronto, arrastar de Novos para Prontos; detalhe do pedido; finalizados; produto esgotado; criar e apagar produto; horário de funcionamento e "Fora do horário"; logo; papéis da equipe; convite por link; loja nova em análise |
| Entregador | online salvo; oferta e aceite; retirada; código errado recusado e certo confirma; desistir com motivo; ganhos e histórico; veículo e documentos; conta em análise |
| Admin | visão geral e mapa da frota ao vivo; aprovações; pedidos e detalhe; designar entregador; cancelar com motivo; tratar denúncia; bloquear e desbloquear conta; suspender e reativar loja; tirar e liberar produto; regras |
| Conta | login digitado em cada perfil; esqueci minha senha com e-mail no Mailpit; link de uso único; convite criando conta e caindo no kanban |
| Celular | nada rola na horizontal; "Mais" com voltar; botão sozinho com largura total; abas da loja; kanban com abas por etapa |

Em todos os passos, o navegador não registrou erro de console, exceção na página nem resposta
5xx/403/404 inesperada.
