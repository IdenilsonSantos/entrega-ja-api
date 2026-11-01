import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import dataSource from './infra/database/data-source';
import { Address } from './modules/addresses/address.entity';
import { MenuCategory, OptionGroup, Product } from './modules/catalog/catalog.entity';
import { CourierProfile, VehicleType } from './modules/couriers/courier-profile.entity';
import { StoreMember, StoreRole } from './modules/merchant/store-member.entity';
import { Report, ReportReason, ReportTarget } from './modules/moderation/moderation.entity';
import { Order, OrderItem, OrderStatus, PaymentMethod } from './modules/orders/order.entity';
import { Store, StoreStatus } from './modules/stores/store.entity';
import { Role, User, UserStatus } from './modules/users/user.entity';

/**
 * Aplica as migrations e, com o banco vazio, cria os dados de demonstração.
 * Roda antes de cada versão nova (é idempotente). Senha de todas as contas: 123456.
 * SEED_DEMO_HISTORY=true também gera duas semanas de pedidos entregues (relatórios).
 */
async function main() {
  await dataSource.initialize();
  const applied = await dataSource.runMigrations({ transaction: 'each' });
  if (applied.length) console.log(`Migrations: ${applied.map((m) => m.name).join(', ')}`);

  const users = dataSource.getRepository(User);
  if (await users.count()) {
    console.log('Banco já tem dados; seed de demonstração ignorado');
    return dataSource.destroy();
  }

  const passwordHash = await bcrypt.hash('123456', 10);
  const mk = (name: string, email: string, role: Role, extra: Partial<User> = {}) => users.save(users.create({ name, email, role, passwordHash, ...extra }));

  const admin = await mk('Ana Admin', 'admin@demo.com', Role.ADMIN);
  const cliente = await mk('Carla Cliente', 'cliente@demo.com', Role.CUSTOMER, { phone: '(11) 98888-1111' });
  const cliente2 = await mk('Bruno Souza', 'bruno@demo.com', Role.CUSTOMER, { phone: '(11) 97777-2222' });
  const dono = await mk('Lucas Lojista', 'loja@demo.com', Role.MERCHANT, { phone: '(11) 3333-1000' });
  const gerente = await mk('Gabriela Gerente', 'gerente@demo.com', Role.MERCHANT);
  const atendente = await mk('Alan Atendente', 'atendente@demo.com', Role.MERCHANT);
  const dono2 = await mk('Paula Pizzaiola', 'loja2@demo.com', Role.MERCHANT, { phone: '(11) 3333-2000' });

  const couriers = [
    { name: 'Diego Entregador', email: 'entregador1@demo.com', v: VehicleType.MOTORCYCLE, model: 'Honda CG 160', color: 'Vermelha', plate: 'FUN4D23' },
    { name: 'Elisa Rocha', email: 'entregador2@demo.com', v: VehicleType.MOTORCYCLE, model: 'Yamaha Factor 150', color: 'Preta', plate: 'GHI7J89' },
    { name: 'Fábio Pedal', email: 'entregador3@demo.com', v: VehicleType.BICYCLE, model: 'Caloi Elite', color: 'Azul', plate: null },
  ];
  const courierUsers: User[] = [];
  for (const [i, c] of couriers.entries()) {
    const u = await mk(c.name, c.email, Role.COURIER, { phone: `(11) 9666${i}-000${i}` });
    await dataSource.getRepository(CourierProfile).save({
      userId: u.id, vehicleType: c.v, vehicleModel: c.model, vehicleColor: c.color, vehiclePlate: c.plate,
      document: `1234567890${i}`, licenseNumber: c.plate ? `0${i}234567890` : null, pixKey: c.email, approvedAt: new Date(),
    });
    courierUsers.push(u);
  }
  // um entregador esperando aprovação, para a fila do admin
  const novo = await mk('Gil Novato', 'entregador4@demo.com', Role.COURIER, { status: UserStatus.PENDING, phone: '(11) 95555-4444' });
  await dataSource.getRepository(CourierProfile).save({ userId: novo.id, vehicleType: VehicleType.MOTORCYCLE, vehicleModel: 'Honda Biz', vehicleColor: 'Branca', vehiclePlate: 'KLM1N23', document: '98765432100', licenseNumber: '09876543210', pixKey: '(11) 95555-4444' });

  await dataSource.getRepository(Address).save([
    { userId: cliente.id, label: 'Casa', street: 'Rua Frei Caneca, 500', complement: 'Apto 42', reference: 'Portaria 24h', lat: -23.5551, lng: -46.6527, isDefault: true },
    { userId: cliente.id, label: 'Trabalho', street: 'Av. Paulista, 1578', complement: '12º andar', reference: null, lat: -23.5614, lng: -46.6559, isDefault: false },
    { userId: cliente2.id, label: 'Casa', street: 'Rua Augusta, 1200', complement: null, reference: null, lat: -23.5565, lng: -46.6597, isDefault: true },
  ]);

  const stores = dataSource.getRepository(Store);
  const burger = await stores.save(stores.create({ ownerId: dono.id, name: 'Burger da Vila', description: 'Hambúrguer artesanal na brasa, pão de fermentação natural.', category: 'Lanches', phone: '(11) 3333-1001', address: 'Rua Haddock Lobo, 210', lat: -23.5578, lng: -46.6631, deliveryFeeCents: 599, minOrderCents: 2000, prepTimeMin: 25, isOpen: true, status: StoreStatus.ACTIVE, ratingAvg: 4.7, ratingCount: 128 }));
  const sushi = await stores.save(stores.create({ ownerId: dono.id, name: 'Sushi Paulista', description: 'Combinados, temakis e pratos quentes.', category: 'Japonesa', phone: '(11) 3333-1002', address: 'Alameda Santos, 1100', lat: -23.5647, lng: -46.6551, deliveryFeeCents: 799, minOrderCents: 4000, prepTimeMin: 35, isOpen: true, status: StoreStatus.ACTIVE, ratingAvg: 4.5, ratingCount: 76 }));
  const pizza = await stores.save(stores.create({ ownerId: dono2.id, name: 'Pizzaria Bella', description: 'Pizza napolitana em forno a lenha.', category: 'Pizza', phone: '(11) 3333-2001', address: 'Rua Bela Cintra, 900', lat: -23.5592, lng: -46.6612, deliveryFeeCents: 699, minOrderCents: 3000, prepTimeMin: 30, isOpen: true, status: StoreStatus.ACTIVE, ratingAvg: 4.8, ratingCount: 203,
    // abre e fecha sozinha: de terça a domingo, das 18h às 23h30 (sexta e sábado até 1h)
    openingHours: [0, 2, 3, 4, 5, 6].map((day) => ({ day, open: '18:00', close: day === 5 || day === 6 ? '01:00' : '23:30' })) }));
  const acai = await stores.save(stores.create({ ownerId: dono2.id, name: 'Açaí do Parque', description: 'Açaí na tigela com mais de 20 complementos.', category: 'Doces', address: 'Rua Peixoto Gomide, 300', lat: -23.5603, lng: -46.6578, status: StoreStatus.PENDING }));

  await dataSource.getRepository(StoreMember).save([
    { storeId: burger.id, userId: dono.id, role: StoreRole.OWNER },
    { storeId: sushi.id, userId: dono.id, role: StoreRole.OWNER },
    { storeId: burger.id, userId: gerente.id, role: StoreRole.MANAGER },
    { storeId: burger.id, userId: atendente.id, role: StoreRole.ATTENDANT },
    { storeId: sushi.id, userId: atendente.id, role: StoreRole.ATTENDANT },
    { storeId: pizza.id, userId: dono2.id, role: StoreRole.OWNER },
    { storeId: acai.id, userId: dono2.id, role: StoreRole.OWNER },
  ]);

  const ponto: OptionGroup = { id: 'ponto', name: 'Ponto da carne', min: 1, max: 1, options: [{ id: 'mal', name: 'Mal passado', priceCents: 0 }, { id: 'ao', name: 'Ao ponto', priceCents: 0 }, { id: 'bem', name: 'Bem passado', priceCents: 0 }] };
  const adicionais: OptionGroup = { id: 'add', name: 'Adicionais', min: 0, max: 3, options: [{ id: 'bacon', name: 'Bacon', priceCents: 500 }, { id: 'queijo', name: 'Queijo extra', priceCents: 400 }, { id: 'ovo', name: 'Ovo', priceCents: 300 }] };
  const tamanho: OptionGroup = { id: 'tam', name: 'Tamanho', min: 1, max: 1, options: [{ id: 'm', name: 'Média (6 fatias)', priceCents: 0 }, { id: 'g', name: 'Grande (8 fatias)', priceCents: 1200 }] };

  const menu: Record<string, { section: string; items: [string, string, number, OptionGroup[]?][] }[]> = {
    [burger.id]: [
      { section: 'Burgers', items: [['Vila Clássico', 'Blend 160g, queijo, alface, tomate e molho da casa', 3290, [ponto, adicionais]], ['Cheddar Bacon', 'Blend 160g, cheddar inglês e bacon crocante', 3790, [ponto, adicionais]], ['Veggie', 'Hambúrguer de grão-de-bico, queijo e rúcula', 3190, [adicionais]]] },
      { section: 'Acompanhamentos', items: [['Batata rústica', 'Com alecrim e páprica', 1690], ['Onion rings', '10 unidades com molho barbecue', 1890]] },
      { section: 'Bebidas', items: [['Refrigerante lata', '350 ml', 690], ['Limonada da casa', '500 ml', 1090]] },
    ],
    [sushi.id]: [
      { section: 'Combinados', items: [['Combo 20 peças', 'Sashimi, niguiri e uramaki', 7990], ['Combo salmão 16', 'Só salmão', 6490]] },
      { section: 'Temakis', items: [['Temaki salmão', 'Salmão, cebolinha e cream cheese', 3290], ['Temaki skin', 'Pele de salmão grelhada', 2690]] },
    ],
    [pizza.id]: [
      { section: 'Pizzas', items: [['Margherita', 'Tomate San Marzano, muçarela de búfala e manjericão', 5490, [tamanho]], ['Calabresa', 'Calabresa artesanal e cebola roxa', 5290, [tamanho]], ['Quatro queijos', 'Muçarela, gorgonzola, parmesão e catupiry', 5990, [tamanho]]] },
      { section: 'Bebidas', items: [['Água com gás', '500 ml', 590]] },
    ],
  };
  const products: Record<string, Product[]> = {};
  for (const [storeId, sections] of Object.entries(menu)) {
    products[storeId] = [];
    for (const [ci, sec] of sections.entries()) {
      const cat = await dataSource.getRepository(MenuCategory).save({ storeId, name: sec.section, position: ci });
      for (const [pi, [name, description, priceCents, optionGroups]] of sec.items.entries()) {
        products[storeId].push(await dataSource.getRepository(Product).save({ storeId, categoryId: cat.id, name, description, priceCents, optionGroups: optionGroups ?? [], position: ci * 100 + pi }));
      }
    }
  }

  await dataSource.getRepository(Report).save({ reporterId: cliente2.id, targetType: ReportTarget.STORE, targetId: sushi.id, targetName: sushi.name, reason: ReportReason.FOOD_SAFETY, details: 'O peixe chegou com cheiro estranho no último pedido.' });

  if (process.env.SEED_DEMO_HISTORY === 'true') await history([burger, sushi, pizza], products, [cliente, cliente2], courierUsers);

  console.log('Dados de demonstração criados. Contas (senha 123456): admin@demo.com, cliente@demo.com, loja@demo.com, gerente@demo.com, atendente@demo.com, loja2@demo.com, entregador1@demo.com … entregador4@demo.com');
  void admin;
  await dataSource.destroy();
}

/** Pedidos entregues nos últimos 14 dias, para gráficos e relatórios terem o que mostrar */
async function history(stores: Store[], products: Record<string, Product[]>, customers: User[], couriers: User[]) {
  const orders: Partial<Order>[] = [];
  for (let d = 13; d >= 0; d--) {
    const n = randomInt(6, 14);
    for (let i = 0; i < n; i++) {
      const store = stores[randomInt(0, stores.length)];
      const menu = products[store.id];
      const items: OrderItem[] = Array.from({ length: randomInt(1, 4) }, () => {
        const p = menu[randomInt(0, menu.length)];
        const qty = randomInt(1, 3);
        return { productId: p.id, name: p.name, qty, unitCents: p.priceCents, options: [], totalCents: p.priceCents * qty };
      });
      const subtotal = items.reduce((s, x) => s + x.totalCents, 0);
      const created = new Date(Date.now() - d * 86400_000 - randomInt(1, 10) * 3600_000);
      const at = (min: number) => new Date(created.getTime() + min * 60_000);
      const lost = randomInt(0, 12) === 0;
      orders.push({
        customerId: customers[randomInt(0, customers.length)].id,
        storeId: store.id,
        courierId: lost ? null : couriers[randomInt(0, couriers.length)].id,
        status: lost ? OrderStatus.REJECTED : OrderStatus.DELIVERED,
        items,
        subtotalCents: subtotal,
        deliveryFeeCents: store.deliveryFeeCents,
        totalCents: subtotal + store.deliveryFeeCents,
        courierFeeCents: 500 + randomInt(100, 600),
        platformFeeCents: Math.round(subtotal * 0.12),
        paymentMethod: [PaymentMethod.PIX, PaymentMethod.CARD, PaymentMethod.CASH][randomInt(0, 3)],
        deliveryAddress: 'Rua Frei Caneca, 500',
        deliveryLat: -23.5551,
        deliveryLng: -46.6527,
        distanceKm: 1.2,
        deliveryCode: String(randomInt(0, 10000)).padStart(4, '0'),
        createdAt: created,
        ...(lost
          ? { cancelledAt: at(3), cancelledBy: 'STORE' as const, cancelReason: 'Ingrediente em falta' }
          : { acceptedAt: at(2), readyAt: at(20 + randomInt(0, 10)), assignedAt: at(22 + randomInt(0, 10)), pickedUpAt: at(32), deliveredAt: at(45 + randomInt(0, 10)), rating: randomInt(0, 3) ? randomInt(4, 6) : null }),
      });
    }
  }
  await dataSource.getRepository(Order).save(orders, { chunk: 100 });
  console.log(`${orders.length} pedidos de exemplo criados`);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
