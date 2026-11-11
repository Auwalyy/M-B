import {
  PERMISSIONS,
  cancelOrderSchema,
  cartBranchSchema,
  cartItemSchema,
  checkoutSchema,
  deliveryZoneSchema,
  idParams,
  listOrdersQuery,
  listZonesQuery,
  paginationQuery,
  promotionSchema,
  quoteSchema,
  trackOrderQuery,
  updateDeliveryZoneSchema,
  updatePromotionSchema,
} from '@mb/shared';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import type { AuthContext } from '../../core/auth/AuthContext';
import { assertTrustedOrigin } from '../../core/http/origin';
import type { ModuleRouter } from '../../core/http/route';
import { type CartOwner, clearCart, getCart, mergeGuestCart, newGuestToken, quote, setCartBranch, setCartItem } from './cart.service';
import { cancelMyOrder, getMyOrder, getOrder, listMyOrders, listOrders, placeOrder, staffCancelOrder, trackOrder } from './order.service';
import { createPromotion, createZone, listPromotions, listPublicPromotions, listZones, updatePromotion, updateZone } from './promotion.service';

const P = PERMISSIONS;
export const CART_COOKIE = 'mb_cart';
const CART_COOKIE_PATH = '/api/v1';

function guestToken(req: Request): string | null {
  const t = req.cookies?.[CART_COOKIE];
  return typeof t === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(t) ? t : null;
}

function setGuestCookie(res: Response, token: string) {
  res.cookie(CART_COOKIE, token, { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: CART_COOKIE_PATH, domain: env.COOKIE_DOMAIN, maxAge: 30 * 86_400_000 });
}

/** Signed-in shoppers use their account cart; guests get a cart cookie on their first change. */
function owner(req: Request, res: Response, auth: AuthContext | null, create: boolean): CartOwner {
  if (auth) return { userId: auth.userId };
  let token = guestToken(req);
  if (!token && create) {
    token = newGuestToken();
    setGuestCookie(res, token);
  }
  return { guestToken: token };
}

export function registerCartRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'The shopping cart with live prices and stock levels at the chosen branch',
    auth: 'optional',
    handler: ({ req, res, maybeAuth }) => getCart(owner(req, res, maybeAuth, false)),
  });
  m.route({
    method: 'put',
    path: '/items',
    summary: 'Set the quantity of a product in the cart (0 removes it)',
    auth: 'optional',
    body: cartItemSchema,
    handler: ({ req, res, body, maybeAuth }) => {
      assertTrustedOrigin(req);
      return setCartItem(owner(req, res, maybeAuth, true), body);
    },
  });
  m.route({
    method: 'put',
    path: '/branch',
    summary: 'Choose the branch to order from',
    auth: 'optional',
    body: cartBranchSchema,
    handler: ({ req, res, body, maybeAuth }) => {
      assertTrustedOrigin(req);
      return setCartBranch(owner(req, res, maybeAuth, true), body.branch);
    },
  });
  m.route({
    method: 'delete',
    path: '/',
    summary: 'Empty the cart',
    auth: 'optional',
    status: 204,
    handler: async ({ req, res, maybeAuth }) => {
      assertTrustedOrigin(req);
      await clearCart(owner(req, res, maybeAuth, false));
    },
  });
  m.route({
    method: 'post',
    path: '/merge',
    summary: 'After sign-in, move the guest cart into the account',
    status: 200,
    handler: async ({ req, res, auth }) => {
      assertTrustedOrigin(req);
      const cart = await mergeGuestCart(auth.userId, guestToken(req));
      res.clearCookie(CART_COOKIE, { path: CART_COOKIE_PATH, domain: env.COOKIE_DOMAIN });
      return cart;
    },
  });
}

export function registerCheckoutRoutes(m: ModuleRouter): void {
  m.route({
    method: 'post',
    path: '/quote',
    summary: 'Price the cart: subtotal, promotion, delivery fee, total, and anything blocking the order',
    auth: 'optional',
    body: quoteSchema,
    status: 200,
    handler: async ({ req, res, body, maybeAuth }) => {
      const result = await quote(owner(req, res, maybeAuth, false), body, maybeAuth?.customerId ? new Types.ObjectId(maybeAuth.customerId) : null);
      return result.dto;
    },
  });
  m.route({
    method: 'post',
    path: '/',
    summary: 'Place the order: holds the stock at the branch and empties the cart',
    description: 'Prices are recalculated on the server; anything sent by the browser is ignored. Send the same idempotencyKey when retrying.',
    auth: 'optional',
    rateLimit: 'sensitive',
    body: checkoutSchema,
    handler: ({ req, res, body, maybeAuth, meta }) => {
      assertTrustedOrigin(req);
      return placeOrder(owner(req, res, maybeAuth, false), maybeAuth, body, meta);
    },
  });
}

const referenceParams = z.object({ reference: z.string().trim().toUpperCase().regex(/^ORD-[A-Z]{3}\d{2}-\d{6,}$/) });

export function registerOrderRoutes(m: ModuleRouter): void {
  m.route({ method: 'get', path: '/mine', summary: 'Your orders', query: paginationQuery, handler: ({ query, auth }) => listMyOrders(auth, query.page, query.limit) });
  m.route({ method: 'get', path: '/mine/:reference', summary: 'One of your orders', params: referenceParams, handler: ({ params, auth }) => getMyOrder(auth, params.reference) });
  m.route({
    method: 'post',
    path: '/mine/:reference/cancel',
    summary: 'Cancel your order before the branch starts preparing it (releases the held stock)',
    params: referenceParams,
    body: cancelOrderSchema,
    status: 200,
    handler: ({ params, body, auth, meta }) => cancelMyOrder(auth, params.reference, body.reason, meta),
  });
  m.route({
    method: 'get',
    path: '/track',
    summary: 'Track an order with its number and the phone used at checkout',
    auth: 'none',
    rateLimit: 'sensitive',
    query: trackOrderQuery,
    handler: ({ query }) => trackOrder(query.reference, query.phone),
  });
  m.route({ method: 'get', path: '/', summary: 'Orders at your branches', permission: P.ORDERS_READ, query: listOrdersQuery, handler: ({ query, auth }) => listOrders(auth, query) });
  m.route({ method: 'get', path: '/:id', summary: 'An order', permission: P.ORDERS_READ, params: idParams, handler: ({ params, auth }) => getOrder(auth, params.id) });
  m.route({
    method: 'post',
    path: '/:id/cancel',
    summary: 'Cancel an order (releases the held stock)',
    permission: P.ORDERS_CANCEL,
    params: idParams,
    body: cancelOrderSchema,
    status: 200,
    handler: ({ params, body, auth, meta }) => staffCancelOrder(auth, params.id, body.reason, meta),
  });
}

export function registerPromotionRoutes(m: ModuleRouter): void {
  m.route({ method: 'get', path: '/active', summary: 'Promotions running now (for banners)', auth: 'none', handler: () => listPublicPromotions() });
  m.route({ method: 'get', path: '/', summary: 'All promotions', permission: P.PROMOTIONS_MANAGE, handler: () => listPromotions() });
  m.route({ method: 'post', path: '/', summary: 'Create a promotion', permission: P.PROMOTIONS_MANAGE, body: promotionSchema, handler: ({ body, auth, meta }) => createPromotion(auth, body, meta) });
  m.route({ method: 'patch', path: '/:id', summary: 'Edit a promotion', permission: P.PROMOTIONS_MANAGE, params: idParams, body: updatePromotionSchema, handler: ({ params, body, auth, meta }) => updatePromotion(auth, params.id, body, meta) });
}

export function registerDeliveryZoneRoutes(m: ModuleRouter): void {
  m.route({ method: 'get', path: '/', summary: 'Delivery areas and fees (per branch)', auth: 'optional', query: listZonesQuery, handler: ({ query, maybeAuth }) => listZones(maybeAuth, query.branch) });
  m.route({ method: 'post', path: '/', summary: 'Add a delivery area', permission: P.DELIVERY_ZONES_MANAGE, body: deliveryZoneSchema, handler: ({ body, auth, meta }) => createZone(auth, body, meta) });
  m.route({ method: 'patch', path: '/:id', summary: 'Edit a delivery area', permission: P.DELIVERY_ZONES_MANAGE, params: idParams, body: updateDeliveryZoneSchema, handler: ({ params, body, auth, meta }) => updateZone(auth, params.id, body, meta) });
}
