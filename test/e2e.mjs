/**
 * Teste de ponta a ponta contra a API rodando com o seed de demonstração.
 *   API=http://localhost:3000/api node test/e2e.mjs
 * Para não esperar muito, suba a API com DISPATCH_OFFER_TTL_SEC=6 DISPATCH_RETRY_DELAY_MS=1500 DISPATCH_ALERT_AFTER=3.
 * O teste muda o banco (cria pedidos, convites, bloqueios): rode num banco de teste.
 * Os e-mails são lidos no Mailpit: suba a API com MAIL_PROVIDER=smtp SMTP_URL=smtp://localhost:1025
 * (o docker-compose já traz o Mailpit; a caixa de entrada fica em http://localhost:8025).
 */
const API = process.env.API ?? 'http://localhost:3000/api';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025';
let failures = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
  if (!cond) failures++;
};
const section = (t) => console.log(`\n── ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
}
const get = (p, t) => http('GET', p, t);
const post = (p, t, b) => http('POST', p, t, b ?? {});
const login = async (email) => {
  const r = await post('/auth/login', null, { email, password: '123456' });
  if (r.status !== 200) throw new Error(`login ${email}: ${JSON.stringify(r.data)}`);
  return r.data;
};
async function until(fn, ms = 15000, step = 300) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/** Último e-mail para o endereço no Mailpit, com o texto (espera chegar, se precisar) */
async function mailTo(to, subject) {
  return until(async () => {
    const list = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to} subject:"${subject}"`)}`).then((r) => r.json());
    const id = list.messages?.[0]?.ID;
    return id ? fetch(`${MAILPIT}/api/v1/message/${id}`).then((r) => r.json()) : null;
  }, 15000, 400);
}
const clearMail = () => fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
const resetLink = (mail) => /\/redefinir-senha\/([\w-]+)/.exec(mail?.Text ?? '');

/** Cliente SSE mínimo: guarda os eventos recebidos */
function sse(token) {
  const events = [];
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${API}/events/stream`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : null });
        }
      }
    } catch {}
  })();
  return { events, close: () => ctrl.abort(), has: (name, pred = () => true) => events.some((e) => e.event === name && pred(e.data)) };
}

const [admin, cust, owner, manager, attendant, c1, c2, c3] = await Promise.all(
  ['admin@demo.com', 'cliente@demo.com', 'loja@demo.com', 'gerente@demo.com', 'atendente@demo.com', 'entregador1@demo.com', 'entregador2@demo.com', 'entregador3@demo.com'].map(login),
);
const A = admin.token, C = cust.token, O = owner.token, M = manager.token, AT = attendant.token;

// ─────────────────────────────────────────────────────────────
section('Catálogo e conta');
const me = await get('/me', O);
ok(me.data.role === 'MERCHANT' && me.data.stores.length === 2 && me.data.stores.every((s) => s.role === 'OWNER'), 'dono vê as duas lojas dele com o papel', me.data.stores);
const att = await get('/me', AT);
ok(att.data.stores.length === 2 && att.data.stores.every((s) => s.role === 'ATTENDANT' && !s.permissions.includes('menu.edit')), 'atendente está em duas lojas, sem permissão de editar cardápio');
const near = await get('/stores?lat=-23.5551&lng=-46.6527', null);
ok(near.status === 200 && near.data.length === 3 && near.data.every((s) => s.distanceKm !== undefined), 'vitrine pública lista as 3 lojas aprovadas, sem a pendente', near.data?.map?.((s) => s.name));
const burger = near.data.find((s) => s.name === 'Burger da Vila');
const store = (await get(`/stores/${burger.id}`, null)).data;
ok(store.sections.length === 3, 'cardápio da loja vem em seções');
const classic = store.sections[0].products.find((p) => p.name === 'Vila Clássico');
const fries = store.sections[1].products[0];
const search = await get('/stores?lat=-23.5551&lng=-46.6527&q=temaki', null);
ok(search.data.length === 1 && search.data[0].name === 'Sushi Paulista', 'busca encontra a loja pelo nome do produto');

// ─────────────────────────────────────────────────────────────
section('Pedido: criação e validação');
const addr = (await get('/addresses', C)).data.find((a) => a.isDefault);
const bad = await post('/orders', C, { storeId: burger.id, addressId: addr.id, paymentMethod: 'PIX', items: [{ productId: classic.id, qty: 1 }] });
ok(bad.status === 400 && /Ponto da carne/.test(bad.data.message), 'opção obrigatória faltando é recusada', bad.data);
const orderBody = { storeId: burger.id, addressId: addr.id, paymentMethod: 'CASH', changeForCents: 10000, items: [{ productId: classic.id, qty: 2, options: [{ groupId: 'ponto', optionIds: ['ao'] }, { groupId: 'add', optionIds: ['bacon'] }] }, { productId: fries.id, qty: 1 }] };
const created = await post('/orders', C, orderBody);
ok(created.status === 201 && created.data.status === 'PENDING', 'pedido criado', created.data);
const order = created.data;
ok(order.subtotalCents === (3290 + 500) * 2 + 1690 && order.totalCents === order.subtotalCents + 599, 'preço calculado no servidor (opções e taxa)', order);
ok(/^\d{4}$/.test(order.deliveryCode) && order.courier === null, 'cliente recebe o código de entrega e ainda não vê entregador');

const ownerSse = sse(O);
const custSse = sse(C);
const c1Sse = sse(c1.token);
await sleep(400);

// entregador fica online perto da loja antes do pedido ficar pronto
const online = await post('/courier/presence', c1.token, { online: true, lat: -23.5579, lng: -46.663 });
ok(online.status === 200, 'entregador 1 fica online', online.data);
const relog = await login('entregador1@demo.com');
ok((await get('/courier/status', relog.token)).data.wantsOnline === true, 'online fica salvo: ao entrar de novo, o app já sabe que deve ligar sozinho');

const storeOrders = await get(`/merchant/stores/${burger.id}/orders?scope=active`, AT);
ok(storeOrders.data.items.some((o) => o.id === order.id && o.customer.name === 'Carla Cliente' && o.deliveryCode === undefined), 'atendente vê o pedido com dados da cliente e sem o código');
const accepted = await post(`/merchant/orders/${order.id}/accept`, AT);
ok(accepted.data.status === 'PREPARING', 'atendente aceita → em preparo', accepted.data);
const twice = await post(`/merchant/orders/${order.id}/accept`, O);
ok(twice.status === 409, 'aceitar de novo dá conflito (dois cliques ao mesmo tempo)');

await sleep(2500);
const st1 = await get('/courier/status', c1.token);
ok(st1.data.offer === null, 'em preparo, nenhuma oferta vai para o entregador', st1.data);
const custView1 = await get(`/orders/${order.id}`, C);
ok(custView1.data.courier === null && (await get(`/orders/${order.id}/tracking`, C)).data.courier === null, 'em preparo, a cliente não vê entrega');

// ─────────────────────────────────────────────────────────────
section('Pronto → busca de entregador → oferta → aceite');
const ready = await post(`/merchant/orders/${order.id}/ready`, AT);
ok(ready.data.status === 'READY', 'loja marca pronto', ready.data);
const offer = await until(async () => (await get('/courier/status', c1.token)).data.offer);
ok(offer?.orderId === order.id && offer.feeCents > 0 && offer.pickupKm !== null, 'entregador mais perto recebe a oferta com valor e distância', offer);
ok(await until(() => c1Sse.has('offer.new', (d) => d.orderId === order.id), 3000), 'oferta chega em tempo real (SSE)');
const notifC1 = await get('/notifications?unread=true', c1.token);
ok(notifC1.data.items.some((n) => n.type === 'offer.new'), 'oferta também vira notificação (central + push)');

const acc = await post(`/courier/offers/${order.id}/accept`, c1.token);
ok(acc.status === 200 && acc.data.status === 'READY', 'entregador aceita', acc.data);
const c2try = await post(`/courier/offers/${order.id}/accept`, c2.token);
ok(c2try.status === 409, 'outro entregador não consegue aceitar a mesma oferta');
const custView2 = (await get(`/orders/${order.id}`, C)).data;
ok(custView2.courier?.name === 'Diego Entregador' && custView2.courier.vehicle?.plate === 'FUN4D23', 'agora a cliente vê o entregador e o veículo', custView2.courier);
await post('/courier/location', c1.token, { lat: -23.5575, lng: -46.6625 });
ok((await get(`/orders/${order.id}/tracking`, C)).data.courier?.lat !== undefined, 'cliente vê a posição do entregador');
ok(await until(() => custSse.has('courier.location', (d) => d.orderId === order.id), 3000), 'posição chega em tempo real para a cliente');

// ─────────────────────────────────────────────────────────────
{
  // simula queda de sinal: a presença expira no Redis, mas ele não escolheu sair
  const { execSync } = await import('node:child_process');
  try {
    execSync(`redis-cli del courier:alive:${c1.user.id}`);
    const back = await post('/courier/location', c1.token, { lat: -23.5575, lng: -46.6625 });
    ok(back.data.online === true, 'depois de uma queda de sinal, ele volta online sozinho na próxima localização');
  } catch {
    console.log('  (sem redis-cli: pulei o teste de queda de sinal)');
  }
}
section('Retirada, entrega com código e avaliação');
const pick = await post(`/courier/orders/${order.id}/pickup`, c1.token);
ok(pick.data.status === 'PICKED_UP', 'entregador retira', pick.data);
const wrong = await post(`/courier/orders/${order.id}/deliver`, c1.token, { code: order.deliveryCode === '0000' ? '1111' : '0000' });
ok(wrong.status === 400, 'código errado não entrega');
const done = await post(`/courier/orders/${order.id}/deliver`, c1.token, { code: order.deliveryCode });
ok(done.data.status === 'DELIVERED', 'código certo → entregue', done.data);
const rate = await post(`/orders/${order.id}/rate`, C, { rating: 5, comment: 'Chegou quentinho' });
ok(rate.data.rating === 5, 'cliente avalia');
const custNotes = (await get('/notifications', C)).data.items.map((n) => n.type);
ok(['order.accepted', 'order.ready', 'order.assigned', 'order.picked_up', 'order.delivered'].every((t) => custNotes.includes(t)), 'cliente recebeu um aviso em cada etapa', custNotes);
ok(await until(() => custSse.has('notification') && ownerSse.has('order.updated', (d) => d.id === order.id && d.status === 'DELIVERED'), 3000), 'avisos e mudanças chegam pelo SSE');
const unread = (await get('/notifications/unread-count', C)).data.unread;
const read = await post('/notifications/read', C, {});
ok(unread > 0 && read.data.unread === 0, `marcar como lidas zera o contador (${unread} → 0)`);
const timeline = (await get(`/merchant/orders/${order.id}`, O)).data.timeline.map((e) => e.type);
ok(['created', 'accepted', 'ready', 'assigned', 'picked_up', 'delivered'].every((t) => timeline.includes(t)), 'linha do tempo completa', timeline);
const earn = await get('/courier/earnings', c1.token);
ok(earn.data.todayCount >= 1 && earn.data.today > 0, 'ganhos do entregador atualizados');

// ─────────────────────────────────────────────────────────────
section('Atribuição manual pelo admin');
await post('/courier/presence', c1.token, { online: false });
ok((await get('/courier/status', c1.token)).data.wantsOnline === false, 'ao escolher ficar offline, a preferência é salva');
ok((await post('/courier/location', c1.token, { lat: -23.5575, lng: -46.6625 })).data.online === false, 'offline por escolha não volta sozinho com a localização');
const o2 = (await post('/orders', C, orderBody)).data;
await post(`/merchant/orders/${o2.id}/accept`, O);
await post(`/merchant/orders/${o2.id}/ready`, O);
const cand = await get(`/admin/orders/${o2.id}/couriers`, A);
ok(cand.status === 200 && Array.isArray(cand.data) && cand.data.length >= 3, `lista de entregadores para atribuir aparece (${cand.data?.length})`, cand.data);
ok(cand.data.every((c) => 'online' in c && 'busy' in c && 'vehicleType' in c), 'cada um com online, ocupado e veículo');
const stuck = await until(async () => (await get('/notifications?unread=true', A)).data.items.find((n) => n.type === 'dispatch.stuck' && n.title.includes(`#${o2.number}`)), 12000);
ok(!!stuck, 'sem entregador online, o admin é avisado');
const assign = await post(`/admin/orders/${o2.id}/assign`, A, { courierId: c2.user.id });
ok(assign.status === 200 && assign.data.courier?.id === c2.user.id, 'admin atribui o entregador 2', assign.data);
const c2status = await get('/courier/status', c2.token);
ok(c2status.data.active.some((o) => o.id === o2.id), 'pedido aparece para o entregador 2');
ok((await get('/notifications?unread=true', c2.token)).data.items.some((n) => n.type === 'order.assigned'), 'entregador 2 foi notificado');
const reassign = await post(`/admin/orders/${o2.id}/assign`, A, { courierId: c3.user.id });
ok(reassign.data.courier?.id === c3.user.id && (await get('/notifications?unread=true', c2.token)).data.items.some((n) => n.type === 'order.unassigned'), 'trocar de entregador avisa quem saiu');
const audit = await get('/admin/audit', A);
ok(audit.data.items.filter((a) => a.action === 'order.assign').length >= 2, 'atribuições ficam no registro de auditoria');
const cancel = await post(`/admin/orders/${o2.id}/cancel`, A, { reason: 'Teste de cancelamento pela plataforma' });
ok(cancel.data.status === 'CANCELLED', 'admin cancela o pedido');

// pré-atribuído em preparo: a cliente só vê quando ficar pronto
const o3 = (await post('/orders', C, orderBody)).data;
await post(`/merchant/orders/${o3.id}/accept`, O);
await post(`/admin/orders/${o3.id}/assign`, A, { courierId: c2.user.id });
ok((await get(`/orders/${o3.id}`, C)).data.courier === null, 'entregador definido em preparo continua escondido da cliente');
const p3 = await post(`/courier/orders/${o3.id}/pickup`, c2.token);
ok(p3.status === 400, 'entregador não retira antes de a loja marcar pronto');
await post(`/merchant/orders/${o3.id}/ready`, O);
ok((await get(`/orders/${o3.id}`, C)).data.courier?.id === c2.user.id, 'ao ficar pronto, a cliente passa a ver o entregador');
await post(`/admin/orders/${o3.id}/cancel`, A, { reason: 'Limpeza do teste' });

// ─────────────────────────────────────────────────────────────
section('Equipe da loja e permissões');
const attEdit = await post(`/merchant/stores/${burger.id}/products`, AT, { name: 'X', priceCents: 100 });
ok(attEdit.status === 403, 'atendente não cria produto');
const attAvail = await post(`/merchant/stores/${burger.id}/products/${fries.id}/availability`, AT, { available: false });
ok(attAvail.status === 200, 'atendente marca produto como esgotado');
await post(`/merchant/stores/${burger.id}/products/${fries.id}/availability`, AT, { available: true });
const mgrInviteMgr = await post(`/merchant/stores/${burger.id}/invites`, M, { email: 'outro@demo.com', role: 'MANAGER' });
ok(mgrInviteMgr.status === 403, 'gerente não convida outro gerente');
const email = `atendente${Date.now()}@demo.com`;
const inv = await post(`/merchant/stores/${burger.id}/invites`, M, { email, role: 'ATTENDANT' });
ok(inv.status === 201 && inv.data.link.includes('/convite/'), 'gerente convida atendente e recebe o link', inv.data);
const token = inv.data.link.split('/convite/')[1];
const info = await get(`/invites/${token}`, null);
ok(info.data.storeName === 'Burger da Vila' && info.data.accountExists === false, 'página do convite mostra a loja');
const reg = await post('/auth/register', null, { name: 'Nova Atendente', email, password: '123456', role: 'CUSTOMER', inviteToken: token });
ok(reg.status === 201 && reg.data.user.role === 'MERCHANT', 'cadastro pelo convite cria conta de lojista', reg.data);
const newMe = await get('/me', reg.data.token);
ok(newMe.data.stores?.[0]?.role === 'ATTENDANT', 'nova pessoa já entra na equipe como atendente');
const reuse = await get(`/invites/${token}`, null);
ok(reuse.status === 400, 'convite não vale duas vezes');
const team = await get(`/merchant/stores/${burger.id}/team`, O);
ok(team.data.members.length === 4, 'equipe tem dono, gerente e 2 atendentes', team.data.members);
const newMember = team.data.members.find((m) => m.email === email);
const promote = await http('PATCH', `/merchant/stores/${burger.id}/members/${newMember.id}`, M, { role: 'MANAGER' });
ok(promote.status === 403, 'gerente não promove a gerente');
const promoteOwner = await http('PATCH', `/merchant/stores/${burger.id}/members/${newMember.id}`, O, { role: 'MANAGER' });
ok(promoteOwner.status === 200, 'dono promove a gerente');
const rm = await http('DELETE', `/merchant/stores/${burger.id}/members/${newMember.id}`, O);
ok(rm.status === 200, 'dono remove da equipe');
const newStore = await post('/merchant/stores', O, { name: 'Café Teste', category: 'Cafés', address: 'Rua Teste, 10', lat: -23.556, lng: -46.66 });
ok(newStore.status === 201 && newStore.data.status === 'PENDING', 'nova loja entra em análise');
const openPending = await post(`/merchant/stores/${newStore.data.id}/open`, O, { isOpen: true });
ok(openPending.status === 400, 'loja em análise não abre');
const stats = await get(`/merchant/stores/${burger.id}/stats?days=14`, O);
ok(stats.data.delivered >= 1 && stats.data.daily.length >= 14, 'relatório da loja', stats.data);
ok((await get(`/merchant/stores/${burger.id}/stats`, AT)).status === 403, 'atendente não vê relatório');

// ─────────────────────────────────────────────────────────────
section('Perfil e veículo do entregador');
const prof = await get('/courier/profile', c3.token);
ok(prof.data.vehicleType === 'BICYCLE' && prof.data.missing.length === 0, 'perfil completo da bicicleta');
const badPlate = await http('PATCH', '/courier/profile', c3.token, { vehicleType: 'MOTORCYCLE', vehiclePlate: '123' });
ok(badPlate.status === 400, 'placa inválida é recusada');
const moto = await http('PATCH', '/courier/profile', c3.token, { vehicleType: 'MOTORCYCLE', vehicleModel: 'Honda Pop 110', vehicleColor: 'Preta', vehiclePlate: 'abc-1d23', licenseNumber: '12345678901' });
ok(moto.status === 200 && moto.data.vehiclePlate === 'ABC1D23' && moto.data.missing.length === 0, 'troca para moto com placa normalizada', moto.data);
ok((await get('/notifications?unread=true', A)).data.items.some((n) => n.type === 'courier.updated'), 'moderação é avisada da troca de veículo');
const meUpd = await http('PATCH', '/me', c3.token, { name: 'Fábio Pedal Silva', phone: '(11) 91234-5678' });
ok(meUpd.data.name === 'Fábio Pedal Silva', 'entregador muda nome e telefone');
const pw = await post('/me/password', c3.token, { current: '123456', next: '1234567' });
ok(pw.status === 200 && (await get('/me', c3.token)).status === 401 && (await get('/me', pw.data.token)).status === 200, 'troca de senha derruba o token antigo e devolve um novo');
await post('/me/password', pw.data.token, { current: '1234567', next: '123456' });

// ─────────────────────────────────────────────────────────────
section('Moderação');
const approvals = await get('/admin/approvals', A);
ok(approvals.data.stores.some((s) => s.name === 'Açaí do Parque') && approvals.data.couriers.some((c) => c.email === 'entregador4@demo.com'), 'fila de aprovação tem loja e entregador');
const pend = await login('entregador4@demo.com');
ok((await post('/courier/presence', pend.token, { online: true, lat: -23.55, lng: -46.65 })).status === 403, 'entregador em análise não fica online');
await post(`/admin/users/${pend.user.id}/approve`, A);
ok((await post('/courier/presence', pend.token, { online: true, lat: -23.55, lng: -46.65 })).status === 200, 'aprovado, ele fica online');
await post('/courier/presence', pend.token, { online: false });
const acai = approvals.data.stores.find((s) => s.name === 'Açaí do Parque');
await post(`/admin/stores/${acai.id}/approve`, A);
ok((await get('/stores?lat=-23.5551&lng=-46.6527', null)).data.some((s) => s.id === acai.id), 'loja aprovada aparece na vitrine');

const rem = await post(`/admin/products/${classic.id}/remove`, A, { reason: 'Foto com marca de terceiros' });
ok(rem.status === 200, 'admin tira produto do ar');
ok(!(await get(`/stores/${burger.id}`, null)).data.sections.some((s) => s.products.some((p) => p.id === classic.id)), 'produto some do cardápio público');
ok((await post(`/merchant/stores/${burger.id}/products/${classic.id}/availability`, O, { available: true })).status === 400, 'loja não reativa produto removido');
ok((await get('/notifications?unread=true', O)).data.items.some((n) => n.type === 'product.removed'), 'loja é avisada da remoção');
await post(`/admin/products/${classic.id}/restore`, A);

const rep = await post('/reports', C, { targetType: 'STORE', targetId: near.data.find((s) => s.name === 'Sushi Paulista').id, reason: 'WRONG_INFO', details: 'Horário errado' });
ok(rep.status === 201, 'cliente denuncia uma loja');
const reports = await get('/admin/reports?status=OPEN', A);
ok(reports.data.items.length >= 2, 'denúncias abertas na fila do admin');
const resolve = await post(`/admin/reports/${rep.data.id}/resolve`, A, { status: 'RESOLVED', resolution: 'Loja suspensa até corrigir os dados', action: 'suspend_store' });
ok(resolve.status === 200, 'admin resolve suspendendo a loja');
const sushiId = near.data.find((s) => s.name === 'Sushi Paulista').id;
ok(!(await get('/stores?lat=-23.5551&lng=-46.6527', null)).data.some((s) => s.id === sushiId), 'loja suspensa sai da vitrine');
ok((await get('/notifications', C)).data.items.some((n) => n.type === 'report.closed'), 'quem denunciou recebe a resposta');
await post(`/admin/stores/${sushiId}/reactivate`, A);

const bruno = await login('bruno@demo.com');
await post(`/admin/users/${bruno.user.id}/block`, A, { reason: 'Fraude em pagamentos' });
const blocked = await get('/me', bruno.token);
ok(blocked.status === 401 || blocked.status === 403, 'conta bloqueada perde o acesso na hora');
const blockedLogin = await post('/auth/login', null, { email: 'bruno@demo.com', password: '123456' });
ok(blockedLogin.status === 403 && /Fraude/.test(blockedLogin.data.message), 'login mostra o motivo do bloqueio');
await post(`/admin/users/${bruno.user.id}/unblock`, A);
ok((await get('/admin/users?role=COURIER', A)).data.items.length >= 4, 'admin lista contas por papel');
const ov = await get('/admin/overview', A);
ok(ov.status === 200 && ov.data.daily.length === 14, 'visão geral do admin');
const set = await http('PUT', '/admin/settings', A, { commissionPercent: 10 });
ok(set.data.commissionPercent === 10, 'admin muda a comissão');
await http('PUT', '/admin/settings', A, { commissionPercent: 12 });
ok((await get('/admin/overview', O)).status === 403, 'lojista não acessa o admin');

// ─────────────────────────────────────────────────────────────
section('Push');
const key = await get('/push/vapid-key', null);
ok(key.data.publicKey?.length > 40, 'chave pública VAPID disponível');
const sub = await post('/push/subscriptions', C, { endpoint: 'https://push.example.com/abc123', keys: { p256dh: 'BOr3x', auth: 'x1' } });
ok(sub.status === 201, 'navegador se inscreve');
const dev = await post('/push/devices', c1.token, { token: 'ExponentPushToken[teste123]', platform: 'android' });
ok(dev.status === 201, 'celular registra o token do Expo');
const test = await post('/push/test', C);
ok(test.status === 200 && test.data.web === 1, 'notificação de teste enviada');

// ─────────────────────────────────────────────────────────────
section('Horário de funcionamento');
const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date()));
const patchStore = (token, body) => http('PATCH', `/merchant/stores/${burger.id}`, token, body);
const closedNow = await patchStore(O, { openingHours: [{ day: (today + 3) % 7, open: '09:00', close: '10:00' }] });
ok(closedNow.status === 200 && closedNow.data.isOpen === true && closedNow.data.openNow === false && closedNow.data.opensAt, 'fora do horário: botão ligado, mas a loja não recebe pedidos', closedNow.data);
const shown = (await get(`/stores/${burger.id}`, null)).data;
ok(shown.openNow === false && new Date(shown.opensAt).getTime() > Date.now() && shown.openingHours.length === 1, 'vitrine mostra fechada e quando abre', shown);
const listed = (await get('/stores?lat=-23.5551&lng=-46.6527', null)).data;
const firstClosed = listed.findIndex((x) => !x.openNow);
ok(listed.slice(firstClosed).every((x) => !x.openNow) && listed.find((x) => x.name === 'Burger da Vila').openNow === false, 'lojas fechadas vão para o fim da lista', listed.map((x) => [x.name, x.openNow]));
const closedOrder = await post('/orders', C, orderBody);
ok(closedOrder.status === 400 && /fechada/.test(closedOrder.data.message), 'pedido fora do horário é recusado', closedOrder.data);
const allDay = await patchStore(O, { openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '00:00' })) });
ok(allDay.data.openNow === true && allDay.data.closesAt === null, '24 horas: aberta, sem hora de fechar', allDay.data);
const paused = await post(`/merchant/stores/${burger.id}/open`, AT, { isOpen: false });
ok(paused.status === 200 && (await get(`/stores/${burger.id}`, null)).data.openNow === false, 'botão desligado pausa a loja mesmo no horário');
await post(`/merchant/stores/${burger.id}/open`, AT, { isOpen: true });
ok((await patchStore(O, { openingHours: [{ day: 1, open: '25:00', close: '10:00' }] })).status === 400, 'hora inválida → 400');
ok((await patchStore(O, { openingHours: [{ day: 1, open: '10:00', close: '10:00' }] })).status === 400, 'abertura igual ao fechamento → 400');
ok((await patchStore(O, { timezone: 'Marte/Base' })).status === 400, 'fuso inválido → 400');
ok((await patchStore(AT, { openingHours: null })).status === 403, 'atendente não muda o horário');
const cleared = await patchStore(M, { openingHours: null });
ok(cleared.status === 200 && cleared.data.openingHours === null && cleared.data.openNow === true, 'gerente tira o horário e volta a valer só o botão', cleared.data);

// ─────────────────────────────────────────────────────────────
section('Saúde');
const health = await get('/health', null);
ok(health.status === 200 && health.data.status === 'ok' && health.data.database && health.data.redis, 'API pronta: banco e Redis no ar', health.data);
ok(health.data.workers?.alive >= 1, 'worker vivo (batimento no Redis)', health.data.workers);
ok(['dispatch', 'push', 'mail'].every((q) => typeof health.data.queues?.[q]?.waiting === 'number'), 'tamanho das filas', health.data.queues);
ok((await get('/health/live', null)).status === 200, 'liveness responde');

// ─────────────────────────────────────────────────────────────
section('Limite de requisições');
const victim = `ninguem-${Date.now()}@demo.com`;
const tries = [];
for (let i = 0; i < 11; i++) tries.push(await post('/auth/login', null, { email: victim, password: 'chute' + i }));
ok(tries.slice(0, 10).every((r) => r.status === 401), '10 senhas erradas na mesma conta: 401', tries.map((r) => r.status));
const tooMany = tries[10];
ok(tooMany.status === 429 && Number(tooMany.headers.get('retry-after')) > 0 && /Muitas tentativas/.test(tooMany.data.message), 'a 11ª é barrada com 429 e Retry-After', { status: tooMany.status, body: tooMany.data });
ok((await post('/auth/login', null, { email: 'gerente@demo.com', password: '123456' })).status === 200, 'outra conta do mesmo IP continua entrando');
const many = await Promise.all(Array.from({ length: 30 }, () => get('/health', null)));
ok(many.every((r) => r.status === 200), 'healthcheck fica fora do limite');

// ─────────────────────────────────────────────────────────────
section('Esqueci minha senha');
await clearMail();
const forgotMsg = 'Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha.';
const unknown = await post('/auth/forgot-password', null, { email: `naoexiste-${Date.now()}@demo.com` });
const forgot = await post('/auth/forgot-password', null, { email: 'cliente@demo.com' });
ok(unknown.status === 202 && forgot.status === 202 && unknown.data.message === forgotMsg && forgot.data.message === forgotMsg, 'mesma resposta com ou sem conta (não revela quem tem cadastro)');
const resetMail = await mailTo('cliente@demo.com', 'Redefinir sua senha');
const link = resetLink(resetMail);
ok(!!link && resetMail.HTML.includes(link[0]), 'e-mail com o link chega pela fila (SMTP)', resetMail?.Text);
const resetToken = link?.[1];
const check = await get(`/auth/reset-password/${resetToken}`, null);
ok(check.status === 200 && /^cl•+@demo\.com$/.test(check.data.email), 'link válido mostra o e-mail mascarado', check.data);
ok((await get('/auth/reset-password/' + 'x'.repeat(43), null)).status === 400, 'link inventado → 400');
ok((await post('/auth/reset-password', null, { token: resetToken, password: '123' })).status === 400, 'senha curta → 400');
const reset = await post('/auth/reset-password', null, { token: resetToken, password: 'nova-senha-1' });
ok(reset.status === 200 && reset.data.token && reset.data.user.email === 'cliente@demo.com', 'nova senha salva e já entra', reset.data);
ok((await get('/me', C)).status === 401, 'sessões antigas caem');
ok((await post('/auth/login', null, { email: 'cliente@demo.com', password: '123456' })).status === 401, 'senha antiga não entra mais');
ok((await post('/auth/reset-password', null, { token: resetToken, password: 'outra-senha' })).status === 400, 'link só vale uma vez');
ok(!!(await mailTo('cliente@demo.com', 'Sua senha foi alterada')), 'aviso de senha alterada por e-mail');
// pedir de novo invalida o link anterior
await post('/auth/forgot-password', null, { email: 'gerente@demo.com' });
const first = resetLink(await mailTo('gerente@demo.com', 'Redefinir sua senha'))?.[1];
await clearMail();
await post('/auth/forgot-password', null, { email: 'gerente@demo.com' });
const second = resetLink(await mailTo('gerente@demo.com', 'Redefinir sua senha'))?.[1];
ok(first && second && first !== second && (await get(`/auth/reset-password/${first}`, null)).status === 400 && (await get(`/auth/reset-password/${second}`, null)).status === 200, 'novo pedido invalida o link anterior');
// volta a senha da demonstração
const back = await post('/me/password', reset.data.token, { current: 'nova-senha-1', next: '123456' });
ok(back.status === 200, 'cliente volta para a senha da demonstração');

[ownerSse, custSse, c1Sse].forEach((s) => s.close());
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
