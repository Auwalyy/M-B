import { registerJob } from './core/jobs/scheduler';
import { expireUnattendedOrders } from './modules/commerce/order.service';
import { expireReservations } from './modules/transactions/reservation.service';

/** Background jobs. Each one is safe to run on several instances (see core/jobs/scheduler). */
registerJob('reservations.expire', 5 * 60_000, () => expireReservations());
registerJob('orders.expire_unattended', 15 * 60_000, () => expireUnattendedOrders());
