import {
  PERMISSIONS,
  assignDeliverySchema,
  convertReservationSchema,
  createReservationSchema,
  deliveryStatusSchema,
  idParams,
  listDeliveriesQuery,
  listNotificationsQuery,
  listPaymentsQuery,
  listReservationsQuery,
  noteSchema,
  paystackInitSchema,
  recordPaymentSchema,
  refundSchema,
  rejectSchema,
  staffReservationSchema,
  trackReservationQuery,
  whatsappClickSchema,
  WHATSAPP_CONTEXTS,
  objectId,
} from '@mb/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../../core/errors/AppError';
import { assertTrustedOrigin } from '../../core/http/origin';
import type { ModuleRouter } from '../../core/http/route';
import { applyWhatsAppStatuses, listNotifications, markAllRead, markRead, unreadCount, verifyWhatsAppSignature } from '../notifications/notification.service';
import { buildWhatsAppLink, recordWhatsAppClick } from '../notifications/whatsapp.service';
import { assignDelivery, getDelivery, listDeliveries, updateDeliveryStatus } from './delivery.service';
import { getPayment, handlePaystackWebhook, initializePaystack, listPayments, paymentConfig, recordPayment, refundPayment, reviewPayment, verifyPaystack } from './payment.service';
import {
  actOnReservation,
  convertReservation,
  createReservation,
  createStaffReservation,
  getReservation,
  listMyReservations,
  listReservations,
  trackReservation,
} from './reservation.service';

const P = PERMISSIONS;
const raw = (req: Request) => (req as Request & { rawBody?: Buffer }).rawBody;

export function registerReservationRoutes(m: ModuleRouter): void {
  m.route({
    method: 'post',
    path: '/',
    summary: 'Reserve products at a branch (stock is held until the branch confirms or the hold expires)',
    auth: 'optional',
    rateLimit: 'sensitive',
    body: createReservationSchema,
    handler: ({ req, body, maybeAuth, meta }) => {
      assertTrustedOrigin(req);
      return createReservation(maybeAuth, body, meta);
    },
  });
  m.route({ method: 'post', path: '/staff', summary: 'Reserve for a walk-in, phone or WhatsApp customer (confirmed at once)', permission: P.RESERVATIONS_CREATE, body: staffReservationSchema, handler: ({ body, auth, meta }) => createStaffReservation(auth, body, meta) });
  m.route({ method: 'get', path: '/mine', summary: 'Your reservations', handler: ({ auth }) => listMyReservations(auth) });
  m.route({ method: 'get', path: '/track', summary: 'Track a reservation with its number and phone', auth: 'none', rateLimit: 'sensitive', query: trackReservationQuery, handler: ({ query }) => trackReservation(query.reference, query.phone) });
  m.route({ method: 'get', path: '/', summary: 'Reservations at your branches', permission: P.RESERVATIONS_READ, query: listReservationsQuery, handler: ({ query, auth }) => listReservations(auth, query) });
  m.route({ method: 'get', path: '/:id', summary: 'A reservation (staff, or the customer who made it)', params: idParams, handler: ({ params, auth }) => getReservation(auth, params.id) });
  m.route({ method: 'post', path: '/:id/confirm', summary: 'Confirm a reservation (starts the pickup hold period)', params: idParams, body: noteSchema, status: 200, handler: ({ params, body, auth, meta }) => actOnReservation(auth, params.id, 'confirm', body.note, meta) });
  m.route({ method: 'post', path: '/:id/reject', summary: 'Reject a reservation (releases the stock)', params: idParams, body: rejectSchema, status: 200, handler: ({ params, body, auth, meta }) => actOnReservation(auth, params.id, 'reject', body.reason, meta) });
  m.route({ method: 'post', path: '/:id/cancel', summary: 'Cancel a reservation (releases the stock)', params: idParams, body: noteSchema, status: 200, handler: ({ params, body, auth, meta }) => actOnReservation(auth, params.id, 'cancel', body.note, meta) });
  m.route({ method: 'post', path: '/:id/convert', summary: 'Turn a confirmed reservation into an order at the reserved prices', permission: P.ORDERS_CREATE, params: idParams, body: convertReservationSchema, handler: ({ params, body, auth, meta }) => convertReservation(auth, params.id, body, meta) });
}

export function registerPaymentRoutes(m: ModuleRouter): void {
  m.route({ method: 'get', path: '/config', summary: 'Which payment methods are available (and bank details for transfers)', auth: 'none', handler: () => paymentConfig() });
  m.route({
    method: 'post',
    path: '/paystack/initialize',
    summary: 'Start a card payment for the balance of an order; returns the Paystack checkout URL',
    auth: 'optional',
    rateLimit: 'sensitive',
    body: paystackInitSchema,
    status: 200,
    handler: ({ req, body, maybeAuth, meta }) => {
      assertTrustedOrigin(req);
      return initializePaystack(maybeAuth, body.order, body.phone, meta);
    },
  });
  m.route({
    method: 'get',
    path: '/paystack/verify/:reference',
    summary: 'Check a card payment with Paystack after the customer returns',
    auth: 'none',
    rateLimit: 'sensitive',
    params: z.object({ reference: z.string().trim().regex(/^PAY-[A-Z]{3}\d{2}-\d{6,}$/) }),
    handler: ({ params }) => verifyPaystack(params.reference),
  });
  m.route({ method: 'get', path: '/', summary: 'Payments at your branches', permission: P.PAYMENTS_READ, query: listPaymentsQuery, handler: ({ query, auth }) => listPayments(auth, query) });
  m.route({ method: 'post', path: '/', summary: 'Record a cash, POS or bank-transfer payment', permission: P.PAYMENTS_RECORD, body: recordPaymentSchema, handler: ({ body, auth, meta }) => recordPayment(auth, body, meta) });
  m.route({ method: 'get', path: '/:id', summary: 'A payment', permission: P.PAYMENTS_READ, params: idParams, handler: ({ params, auth }) => getPayment(auth, params.id) });
  m.route({ method: 'post', path: '/:id/confirm', summary: 'Confirm a bank transfer has arrived', permission: P.PAYMENTS_CONFIRM, params: idParams, body: noteSchema, status: 200, handler: ({ params, body, auth, meta }) => reviewPayment(auth, params.id, 'confirm', body.note, meta) });
  m.route({ method: 'post', path: '/:id/reject', summary: 'Mark a bank transfer as not received', permission: P.PAYMENTS_CONFIRM, params: idParams, body: noteSchema, status: 200, handler: ({ params, body, auth, meta }) => reviewPayment(auth, params.id, 'reject', body.note, meta) });
  m.route({ method: 'post', path: '/:id/refunds', summary: 'Refund all or part of a payment (card refunds go through Paystack)', permission: P.PAYMENTS_REFUND, params: idParams, body: refundSchema, handler: ({ params, body, auth, meta }) => refundPayment(auth, params.id, body, meta) });
}

export function registerWebhookRoutes(m: ModuleRouter): void {
  m.route({
    method: 'post',
    path: '/paystack',
    summary: 'Paystack events (HMAC-SHA512 signed). Each event is processed once.',
    auth: 'none',
    status: 200,
    handler: ({ req, body }) => handlePaystackWebhook(raw(req), req.get('x-paystack-signature'), body ?? req.body),
  });
  m.route({
    method: 'get',
    path: '/whatsapp',
    summary: 'Meta webhook verification handshake',
    auth: 'none',
    handler: ({ req, res }) => {
      const q = req.query as Record<string, string | undefined>;
      if (q['hub.mode'] === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && q['hub.verify_token'] === env.WHATSAPP_VERIFY_TOKEN) {
        res.type('text/plain').send(q['hub.challenge'] ?? '');
        return;
      }
      throw new AppError(403, 'FORBIDDEN', 'Verification failed');
    },
  });
  m.route({
    method: 'post',
    path: '/whatsapp',
    summary: 'WhatsApp delivery receipts (sent, delivered, read, failed)',
    auth: 'none',
    status: 200,
    handler: async ({ req }) => {
      if (!verifyWhatsAppSignature(raw(req), req.get('x-hub-signature-256'))) throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid signature');
      return { updated: await applyWhatsAppStatuses(req.body) };
    },
  });
}

export function registerDeliveryRoutes(m: ModuleRouter): void {
  m.route({ method: 'get', path: '/', summary: 'Deliveries at your branches', permission: P.DELIVERY_READ, query: listDeliveriesQuery, handler: ({ query, auth }) => listDeliveries(auth, query) });
  m.route({ method: 'get', path: '/:id', summary: 'A delivery', permission: P.DELIVERY_READ, params: idParams, handler: ({ params, auth }) => getDelivery(auth, params.id) });
  m.route({ method: 'post', path: '/:id/assign', summary: 'Assign a rider (staff member or outside rider)', permission: P.DELIVERY_MANAGE, params: idParams, body: assignDeliverySchema, status: 200, handler: ({ params, body, auth, meta }) => assignDelivery(auth, params.id, body, meta) });
  m.route({ method: 'post', path: '/:id/status', summary: 'Update delivery progress (keeps the order in step)', permission: P.DELIVERY_MANAGE, params: idParams, body: deliveryStatusSchema, status: 200, handler: ({ params, body, auth, meta }) => updateDeliveryStatus(auth, params.id, body.status, body.note, meta) });
}

export function registerNotificationRoutes(m: ModuleRouter): void {
  m.route({ method: 'get', path: '/', summary: 'Your notifications', query: listNotificationsQuery, handler: ({ query, auth }) => listNotifications(auth, query.page, query.limit, query.unread) });
  m.route({ method: 'get', path: '/unread-count', summary: 'Number of unread notifications', handler: ({ auth }) => unreadCount(auth) });
  m.route({ method: 'post', path: '/read-all', summary: 'Mark every notification as read', status: 200, handler: ({ auth }) => markAllRead(auth) });
  m.route({ method: 'post', path: '/:id/read', summary: 'Mark one notification as read', params: idParams, status: 204, handler: ({ params, auth }) => markRead(auth, params.id) });
}

export function registerWhatsAppRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/link',
    summary: 'A wa.me link with a pre-filled message for the right branch',
    auth: 'none',
    query: z.object({ context: z.enum(WHATSAPP_CONTEXTS), ref: z.string().trim().max(100).optional(), branch: objectId.optional() }),
    handler: ({ query }) => buildWhatsAppLink(query.context, query.ref, query.branch),
  });
  m.route({
    method: 'post',
    path: '/click',
    summary: 'Record that a visitor opened a WhatsApp link (intent only; not a delivered message)',
    auth: 'none',
    rateLimit: 'sensitive',
    body: whatsappClickSchema,
    status: 204,
    handler: ({ body }) => recordWhatsAppClick(body.context, body.ref, body.branch),
  });
}
