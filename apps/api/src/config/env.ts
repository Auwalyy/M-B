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
    RATE_LIMIT_SENSITIVE_PER_MINUTE: z.coerce.number().int().min(1).default(20),

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

    /** Paystack secret key (sk_test_… or sk_live_…). Card payments are offered only when set. */
    PAYSTACK_SECRET_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^sk_(test|live)_\w+$/, 'Expected sk_test_… or sk_live_…').optional()),
    PAYSTACK_BASE_URL: z.url().default('https://api.paystack.co'),

    /** WhatsApp Business Platform (Cloud API). Automated messages are sent only when all are set. */
    WHATSAPP_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    WHATSAPP_PHONE_NUMBER_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    WHATSAPP_APP_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    WHATSAPP_VERIFY_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    WHATSAPP_API_VERSION: z.string().default('v21.0'),
    WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('en'),
    /** Approved template names; each receives positional text parameters. */
    WHATSAPP_TEMPLATE_ORDER_UPDATE: z.string().default('order_update'),
    WHATSAPP_TEMPLATE_RESERVATION_UPDATE: z.string().default('reservation_update'),

    JOBS_ENABLED: bool.optional(),
    OUTBOX_POLL_MS: z.coerce.number().int().min(250).default(3000),
    API_DOCS_ENABLED: bool.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    // Refuse to start production with development values.
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (/change-me|dev-only|example/i.test(env.JWT_ACCESS_SECRET) || env.JWT_ACCESS_SECRET.length < 48) issue('JWT_ACCESS_SECRET', 'Use a unique random secret of at least 48 characters in production');
    if (!env.WEB_URL.startsWith('https://')) issue('WEB_URL', 'Must be an https:// address in production');
    if (env.COOKIE_SECURE === false) issue('COOKIE_SECURE', 'Refresh cookies must be secure in production');
    if (env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_') && !env.WEB_URL.includes('staging')) {
      console.warn('Warning: PAYSTACK_SECRET_KEY is a test key; card payments will not take real money.');
    }
  })
  .transform((env) => ({
    ...env,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    apiDocsEnabled: env.API_DOCS_ENABLED ?? env.NODE_ENV !== 'production',
    paystackEnabled: Boolean(env.PAYSTACK_SECRET_KEY),
    whatsappEnabled: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
    jobsEnabled: env.JOBS_ENABLED ?? env.NODE_ENV !== 'test',
    corsOrigins: [env.WEB_URL, ...env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)],
  }));

export type Env = z.output<typeof schema>;
/** Exported for tests of the production guards. */
export const envSchema = schema;

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
