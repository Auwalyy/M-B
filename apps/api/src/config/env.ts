import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4100),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/mudassir?replicaSet=rs0'),

    /** Public URL of the web app, used in emails and for CORS. */
    WEB_URL: z.url().default('http://localhost:3000'),
    /** Extra allowed CORS origins, comma separated. */
    CORS_ORIGINS: z.string().default(''),
    /** Number of reverse proxies in front of the API (for correct client IPs). */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().default('mudassir-brothers-api'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    COOKIE_SECURE: bool.optional(),
    COOKIE_DOMAIN: z.string().optional(),

    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
    RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_AUTH_PER_15_MIN: z.coerce.number().int().min(1).default(20),

    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('Mudassir & Brothers <no-reply@mudassirbrothers.com>'),

    /** cloudinary://<api_key>:<api_secret>@<cloud_name>. Required in production. */
    // An empty value (as in .env.example) means "not configured".
    CLOUDINARY_URL: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().regex(/^cloudinary:\/\/[^:]+:[^@]+@.+$/, 'Expected cloudinary://<api_key>:<api_secret>@<cloud_name>').optional(),
    ),
    CLOUDINARY_FOLDER: z.string().default('mudassir'),
    /** Local image storage for development and tests (ignored when CLOUDINARY_URL is set). */
    UPLOAD_DIR: z.string().default('uploads'),
    MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(5),

    OUTBOX_POLL_MS: z.coerce.number().int().min(250).default(3000),
    API_DOCS_ENABLED: bool.optional(),
  })
  .transform((env) => ({
    ...env,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    apiDocsEnabled: env.API_DOCS_ENABLED ?? env.NODE_ENV !== 'production',
    corsOrigins: [env.WEB_URL, ...env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)],
  }));

export type Env = z.output<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Logger depends on env, so use console here.
    console.error(`Invalid environment configuration:\n${issues}`);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

export const env = load();
