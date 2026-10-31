import { CourierProfile } from '../couriers/courier-profile.entity';
import { DELIVERY_VISIBLE, Order } from './order.entity';

/**
 * Cada perfil vê um recorte do pedido:
 * - cliente: o código de entrega e, só a partir de PRONTO, quem é o entregador e o veículo;
 * - loja: dados da cliente para contato, sem o código;
 * - entregador: endereços e contatos para a corrida, sem o código (ele pede à cliente);
 * - admin: tudo.
 */
export type Viewer = 'customer' | 'store' | 'courier' | 'admin';

export interface LoadedOrder extends Order {
  courierProfile?: CourierProfile | null;
}

const base = (o: LoadedOrder) => ({
  id: o.id,
  number: o.number,
  status: o.status,
  items: o.items,
  subtotalCents: o.subtotalCents,
  deliveryFeeCents: o.deliveryFeeCents,
  totalCents: o.totalCents,
  paymentMethod: o.paymentMethod,
  changeForCents: o.changeForCents,
  notes: o.notes,
  deliveryAddress: o.deliveryAddress,
  deliveryComplement: o.deliveryComplement,
  deliveryReference: o.deliveryReference,
  deliveryLat: o.deliveryLat,
  deliveryLng: o.deliveryLng,
  distanceKm: o.distanceKm,
  createdAt: o.createdAt,
  acceptedAt: o.acceptedAt,
  readyAt: o.readyAt,
  assignedAt: o.assignedAt,
  pickedUpAt: o.pickedUpAt,
  deliveredAt: o.deliveredAt,
  cancelledAt: o.cancelledAt,
  cancelledBy: o.cancelledBy,
  cancelReason: o.cancelReason,
  rating: o.rating,
  ratingComment: o.ratingComment,
  store: o.store && { id: o.store.id, name: o.store.name, logoUrl: o.store.logoUrl, address: o.store.address, lat: o.store.lat, lng: o.store.lng, phone: o.store.phone, prepTimeMin: o.store.prepTimeMin },
});

const courierInfo = (o: LoadedOrder) =>
  o.courier && {
    id: o.courier.id,
    name: o.courier.name,
    phone: o.courier.phone,
    avatarUrl: o.courier.avatarUrl,
    vehicle: o.courierProfile && { type: o.courierProfile.vehicleType, model: o.courierProfile.vehicleModel, color: o.courierProfile.vehicleColor, plate: o.courierProfile.vehiclePlate },
  };

const customerInfo = (o: LoadedOrder) => o.customer && { id: o.customer.id, name: o.customer.name, phone: o.customer.phone };

export function viewOrder(o: LoadedOrder, viewer: Viewer) {
  const b = base(o);
  switch (viewer) {
    case 'customer':
      return { ...b, deliveryCode: o.deliveryCode, courier: DELIVERY_VISIBLE.includes(o.status) ? courierInfo(o) : null };
    case 'store':
      return { ...b, customer: customerInfo(o), courier: courierInfo(o), courierFeeCents: o.courierFeeCents, platformFeeCents: o.platformFeeCents };
    case 'courier':
      return { ...b, customer: customerInfo(o), courierFeeCents: o.courierFeeCents };
    case 'admin':
      return { ...b, storeId: o.storeId, customerId: o.customerId, courierId: o.courierId, customer: customerInfo(o), courier: courierInfo(o), courierFeeCents: o.courierFeeCents, platformFeeCents: o.platformFeeCents };
  }
}
export type OrderView = ReturnType<typeof viewOrder>;
