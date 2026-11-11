import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './core/errors/errorHandler';
import { ModuleRouter, type RegisteredRoute } from './core/http/route';
import { type RateLimitConfig, createRateLimiters } from './core/middleware/rateLimit';
import { requestId } from './core/middleware/requestId';
import { buildOpenApiSpec } from './core/openapi/spec';
import { registerAuditRoutes } from './modules/audit/audit.routes';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { registerBranchRoutes } from './modules/branches/branch.routes';
import { registerRoleRoutes } from './modules/roles/role.routes';
import { registerSettingsRoutes } from './modules/settings/settings.routes';
import { registerUserRoutes } from './modules/users/user.routes';
import { registerBrandRoutes, registerCategoryRoutes, registerProductRoutes } from './modules/catalog/catalog.routes';
import { registerCustomerRoutes, registerEnquiryRoutes, registerSegmentRoutes } from './modules/customers/crm.routes';
import { registerInventoryRoutes } from './modules/inventory/inventory.routes';
import {
  registerCartRoutes,
  registerCheckoutRoutes,
  registerDeliveryZoneRoutes,
  registerOrderRoutes,
  registerPromotionRoutes,
} from './modules/commerce/commerce.routes';
import {
  registerDeliveryRoutes,
  registerNotificationRoutes,
  registerPaymentRoutes,
  registerReservationRoutes,
  registerWebhookRoutes,
  registerWhatsAppRoutes,
} from './modules/transactions/transactions.routes';
import { getStorage, type LocalStorage } from './core/storage/storage';

export const API_PREFIX = '/api/v1';

/** Every module and where it is mounted. New modules are added here. */
const MODULES: { tag: string; path: string; register: (m: ModuleRouter) => void }[] = [
  { tag: 'Auth', path: '/auth', register: registerAuthRoutes },
  { tag: 'Branches', path: '/branches', register: registerBranchRoutes },
  { tag: 'Staff', path: '/users', register: registerUserRoutes },
  { tag: 'Roles', path: '/roles', register: registerRoleRoutes },
  { tag: 'Settings', path: '/settings', register: registerSettingsRoutes },
  { tag: 'Audit', path: '/audit-logs', register: registerAuditRoutes },
  { tag: 'Categories', path: '/categories', register: registerCategoryRoutes },
  { tag: 'Brands', path: '/brands', register: registerBrandRoutes },
  { tag: 'Products', path: '/products', register: registerProductRoutes },
  { tag: 'Inventory', path: '/inventory', register: registerInventoryRoutes },
  { tag: 'Customers', path: '/customers', register: registerCustomerRoutes },
  { tag: 'Customer segments', path: '/customer-segments', register: registerSegmentRoutes },
  { tag: 'Enquiries', path: '/enquiries', register: registerEnquiryRoutes },
  { tag: 'Cart', path: '/cart', register: registerCartRoutes },
  { tag: 'Checkout', path: '/checkout', register: registerCheckoutRoutes },
  { tag: 'Orders', path: '/orders', register: registerOrderRoutes },
  { tag: 'Promotions', path: '/promotions', register: registerPromotionRoutes },
  { tag: 'Delivery zones', path: '/delivery-zones', register: registerDeliveryZoneRoutes },
  { tag: 'Reservations', path: '/reservations', register: registerReservationRoutes },
  { tag: 'Payments', path: '/payments', register: registerPaymentRoutes },
  { tag: 'Deliveries', path: '/deliveries', register: registerDeliveryRoutes },
  { tag: 'Notifications', path: '/notifications', register: registerNotificationRoutes },
  { tag: 'WhatsApp', path: '/whatsapp', register: registerWhatsAppRoutes },
  { tag: 'Webhooks', path: '/webhooks', register: registerWebhookRoutes },
];

export interface AppOptions {
  rateLimits?: Partial<RateLimitConfig>;
}

export function createApp(options: AppOptions = {}): { app: Express; routes: RegisteredRoute[] } {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  // Treat ?a[b]=c as a literal key, not a nested object (blocks query operator injection).
  app.set('query parser', 'simple');

  const limiters = createRateLimiters({
    globalPerMinute: options.rateLimits?.globalPerMinute ?? env.RATE_LIMIT_GLOBAL_PER_MINUTE,
    authPer15Min: options.rateLimits?.authPer15Min ?? env.RATE_LIMIT_AUTH_PER_15_MIN,
    sensitivePerMinute: options.rateLimits?.sensitivePerMinute ?? env.RATE_LIMIT_SENSITIVE_PER_MINUTE,
  });

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
    }),
  );
  // Keep the raw bytes: payment and WhatsApp webhooks are verified with an HMAC over the exact body.
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; } }));
  app.use(cookieParser());

  // Health checks for load balancers and uptime monitors.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/health/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', database: ready ? 'up' : 'down' });
  });

  // Locally stored images (development only; production uses Cloudinary URLs).
  const storage = getStorage();
  if (storage.name === 'local') {
    app.use(
      '/uploads',
      helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
      express.static((storage as LocalStorage).dir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }),
    );
  }

  const routes: RegisteredRoute[] = [];
  const api = express.Router();
  api.use(limiters.global);
  for (const mod of MODULES) {
    const m = new ModuleRouter(routes, mod.tag, `${API_PREFIX}${mod.path}`, limiters.named);
    mod.register(m);
    api.use(mod.path, m.router);
  }
  app.use(API_PREFIX, api);

  if (env.apiDocsEnabled) {
    const spec = buildOpenApiSpec(routes, '/');
    app.get('/api/docs/openapi.json', (_req, res) => {
      res.json(spec);
    });
    app.use(
      '/api/docs',
      helmet({ contentSecurityPolicy: false }),
      swaggerUi.serve,
      swaggerUi.setup(spec, { customSiteTitle: 'Mudassir & Brothers API' }),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, routes };
}
