import { Address } from '../../modules/addresses/address.entity';
import { MenuCategory, Product } from '../../modules/catalog/catalog.entity';
import { CourierProfile } from '../../modules/couriers/courier-profile.entity';
import { StoreInvite, StoreMember } from '../../modules/merchant/store-member.entity';
import { AuditLog, Report } from '../../modules/moderation/moderation.entity';
import { DeviceToken, Notification, PushSubscription } from '../../modules/notifications/notification.entity';
import { Order, OrderEvent } from '../../modules/orders/order.entity';
import { Setting } from '../../modules/settings/setting.entity';
import { Store } from '../../modules/stores/store.entity';
import { User } from '../../modules/users/user.entity';

export const ENTITIES = [
  User, CourierProfile, Address, Store, StoreMember, StoreInvite, MenuCategory, Product,
  Order, OrderEvent, Notification, PushSubscription, DeviceToken, Report, AuditLog, Setting,
];
