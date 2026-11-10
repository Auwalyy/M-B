import type { Permission } from '@mb/shared';
import { type Request, type RequestHandler, type Response, Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env';
import type { z } from 'zod';
import type { AuthContext } from '../auth/AuthContext';
import { forbidden, unauthorized } from '../errors/AppError';
import { authenticate } from '../middleware/authenticate';
import { Page } from './pagination';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
type AnySchema = z.ZodType;
type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

/** Request facts recorded in audit logs. */
export interface RequestMeta {
  ip: string | undefined;
  userAgent: string | undefined;
  requestId: string;
}

export interface RouteContext<B, Q, P> {
  req: Request;
  res: Response;
  body: Out<B>;
  query: Out<Q>;
  params: Out<P>;
  /** The authenticated caller. Throws 401 if the route allowed anonymous access and there is none. */
  auth: AuthContext;
  /** The authenticated caller, or null on routes with `auth: 'optional'`. */
  maybeAuth: AuthContext | null;
  meta: RequestMeta;
  /** Files from a multipart upload (routes with `upload`). */
  files: UploadedFile[];
}

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

export interface RouteDefinition<B extends AnySchema | undefined, Q extends AnySchema | undefined, P extends AnySchema | undefined> {
  method: HttpMethod;
  /** Path relative to the module, Express syntax (`/:id`). */
  path: string;
  summary: string;
  description?: string;
  /** Defaults to 'required'. */
  auth?: 'required' | 'optional' | 'none';
  /** Caller must hold this permission in at least one branch. Branch-level checks happen in services. */
  permission?: Permission;
  /** Allow users who must change their password to call this route. */
  allowPendingPasswordChange?: boolean;
  rateLimit?: RateLimitName;
  /** Accept multipart/form-data image uploads in this field. */
  upload?: { field: string; maxCount: number };
  body?: B;
  query?: Q;
  params?: P;
  /** Success status. 204 sends no body. */
  status?: number;
  handler: (ctx: RouteContext<B, Q, P>) => unknown;
}

export type RateLimitName = 'auth' | 'sensitive';

export interface RegisteredRoute {
  method: HttpMethod;
  fullPath: string;
  tag: string;
  def: RouteDefinition<AnySchema | undefined, AnySchema | undefined, AnySchema | undefined>;
}

export function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 400), requestId: String(req.id) };
}

/**
 * Builds a module's routes. Each route gets authentication, permission check, validation,
 * the response envelope and an OpenAPI entry, so documentation cannot drift from code.
 */
export class ModuleRouter {
  readonly router = Router();

  constructor(
    private readonly registry: RegisteredRoute[],
    private readonly tag: string,
    private readonly mountPath: string,
    private readonly limiters: Record<RateLimitName, RequestHandler>,
  ) {}

  route<B extends AnySchema | undefined = undefined, Q extends AnySchema | undefined = undefined, P extends AnySchema | undefined = undefined>(
    def: RouteDefinition<B, Q, P>,
  ): void {
    const authMode = def.auth ?? 'required';
    const chain: RequestHandler[] = [];
    if (def.rateLimit) chain.push(this.limiters[def.rateLimit]);
    if (authMode !== 'none') {
      chain.push(authenticate({ optional: authMode === 'optional', allowPendingPasswordChange: def.allowPendingPasswordChange }));
    }
    if (def.permission) {
      const permission = def.permission;
      chain.push((req, _res, next) => {
        if (!req.auth) return next(unauthorized());
        if (!req.auth.can(permission)) return next(forbidden());
        next();
      });
    }
    // Parse uploads only after authentication and the permission check.
    if (def.upload) {
      const { field, maxCount } = def.upload;
      chain.push(
        multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: maxCount, fields: 20 } }).array(field, maxCount),
      );
    }
    chain.push(async (req, res) => {
      const body = def.body ? await def.body.parseAsync(req.body ?? {}) : undefined;
      const query = def.query ? await def.query.parseAsync(req.query) : undefined;
      const params = def.params ? await def.params.parseAsync(req.params) : undefined;
      const ctx = {
        req,
        res,
        body,
        query,
        params,
        get auth(): AuthContext {
          if (!req.auth) throw unauthorized();
          return req.auth;
        },
        maybeAuth: req.auth ?? null,
        meta: requestMeta(req),
        files: (Array.isArray(req.files) ? req.files : []) as UploadedFile[],
      } as RouteContext<B, Q, P>;

      const result = await def.handler(ctx);
      if (res.headersSent) return;
      const status = def.status ?? (def.method === 'post' ? 201 : 200);
      if (status === 204 || result === undefined) {
        res.status(status === 204 || result === undefined ? 204 : status).end();
        return;
      }
      if (result instanceof Page) {
        res.status(status).json({ data: result.items, meta: result.meta });
        return;
      }
      res.status(status).json({ data: result });
    });

    this.router[def.method](def.path, ...chain);
    this.registry.push({
      method: def.method,
      fullPath: `${this.mountPath}${def.path === '/' ? '' : def.path}`,
      tag: this.tag,
      def: def as unknown as RegisteredRoute['def'],
    });
  }
}
