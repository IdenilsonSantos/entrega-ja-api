# Visão geral

## Perfis

| Perfil | Onde usa | O que faz |
|---|---|---|
| **Cliente** | site | Vê as lojas que entregam no endereço, monta o pedido com opções, paga na entrega (Pix, cartão ou dinheiro com troco), acompanha no mapa, informa o código de entrega, avalia e denuncia |
| **Loja** (dono, gerente, atendente) | site | Recebe pedidos no kanban com aviso sonoro, aceita, marca pronto, edita cardápio e horário, cuida da equipe e vê os números. Um lojista pode ter várias lojas e participar da equipe de outras |
| **Entregador** | app nativo ou site | Fica online, recebe ofertas perto dele, vai até a loja, retira e entrega com o código da cliente, acompanha ganhos e histórico. Começa em análise até o admin aprovar |
| **Admin** | site | Acompanha a operação ao vivo, aprova lojas e entregadores, designa entregador na mão, cancela pedidos, trata denúncias, bloqueia contas e ajusta as regras (comissão, pagamento do entregador, raio de busca) |

O que cada papel da loja pode fazer está na tabela de permissões do [README da API](../README.md#papéis-e-permissões).

## Regras de negócio principais

- **Preço:** sempre calculado no servidor com o cardápio atual; o pedido guarda uma cópia dos itens.
- **Valores do pedido:** total = subtotal + taxa de entrega da loja. A plataforma fica com a
  comissão sobre o subtotal (padrão 12%); o entregador recebe um fixo mais um valor por km da loja
  até a cliente (padrão R$ 5,00 + R$ 1,50/km). Tudo ajustável em **Admin → Regras**.
- **Entrega:** só a partir de `READY` começa a busca por entregador, e a cliente só vê o entregador a
  partir daí. A entrega só é confirmada com o código de 4 dígitos que a cliente tem.
- **Loja aberta:** o botão do painel ligado e, se houver horário cadastrado, dentro do horário.
- **Contas:** entregador nasce em análise; lojista entra pelo cadastro ou por convite de uma loja;
  conta bloqueada perde o acesso na hora (todas as sessões).

## Rodar tudo na máquina

Pré-requisitos: Node 22 e Docker.

```bash
# 1. API, worker, Postgres, Redis e Mailpit (com dados de demonstração)
cd entrega-ja-api && docker compose up --build        # API em http://localhost:3000/api

# 2. Site
cd entrega-ja-web && npm install && npm run dev        # http://localhost:5173

# 3. App do entregador (opcional)
cd entrega-ja-app && npm install
EXPO_PUBLIC_API_URL=http://SEU_IP:3000/api npx expo start
```

E-mails enviados (recuperação de senha) aparecem em http://localhost:8025.

## Contas de demonstração

Senha de todas: `123456`. No site em modo de desenvolvimento, a tela de entrar tem botões para elas.

| Conta | Perfil |
|---|---|
| `admin@demo.com` | Admin |
| `cliente@demo.com`, `bruno@demo.com` | Clientes |
| `loja@demo.com` | Dono do Burger da Vila e do Sushi Paulista |
| `gerente@demo.com` | Gerente do Burger da Vila |
| `atendente@demo.com` | Atendente nas duas lojas do Lucas |
| `loja2@demo.com` | Dona da Pizzaria Bella (com horário: abre às 18h) e do Açaí do Parque (em análise) |
| `entregador1..3@demo.com` | Entregadores aprovados |
| `entregador4@demo.com` | Entregador em análise |
