// Starts a throwaway copy of the whole system for end-to-end tests:
// an in-memory MongoDB replica set, the seeded development data, the API and the web app.
// Playwright runs this as its web server and stops it when the tests finish.
//
//   E2E_WEB=dev    (default) next dev: no build needed, slower first page loads
//   E2E_WEB=start  next start: needs a production build made with API_URL pointing at this API
//   E2E_WEB=none   database and API only (for building the web app against seeded data, e.g. Lighthouse)
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(import.meta.url);
const tsx = resolve(dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');
const next = resolve(dirname(require.resolve('next/package.json')), 'dist/bin/next');

export const API_PORT = Number(process.env.E2E_API_PORT ?? 4110);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3110);

// next dev keeps fetched data on disk between runs. A fresh database has new ids, so stale
// cached pages would point at branches and products that no longer exist. Clear it before and after.
const clearFetchCache = () => {
  for (const dir of ['.next/dev/cache/fetch-cache', '.next/cache/fetch-cache']) rmSync(resolve(root, 'apps/web', dir), { recursive: true, force: true });
};
clearFetchCache();

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const uri = replSet.getUri('mudassir_e2e');

const apiEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  MONGODB_URI: uri,
  WEB_URL: `http://localhost:${WEB_PORT}`,
  // 3120: a production build served separately for Lighthouse runs.
  CORS_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:3120`,
  JWT_ACCESS_SECRET: 'e2e-only-secret-not-used-anywhere-else-0123456789',
  LOG_LEVEL: 'warn',
  // Tests sign in many times from one address.
  RATE_LIMIT_GLOBAL_PER_MINUTE: '100000',
  RATE_LIMIT_AUTH_PER_15_MIN: '100000',
  RATE_LIMIT_SENSITIVE_PER_MINUTE: '100000',
  JOBS_ENABLED: 'false',
  PAYSTACK_SECRET_KEY: '',
  CLOUDINARY_URL: '',
  WHATSAPP_TOKEN: '',
  SMTP_URL: '',
};

const children = [];
function run(name, args, cwd, env, { wait = false } = {}) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  if (!wait) {
    child.on('exit', (code) => {
      if (code && !stopping) {
        console.error(`[e2e] ${name} exited with ${code}`);
        void stop(1);
      }
    });
    return child;
  }
  return new Promise((ok, fail) => child.on('exit', (code) => (code ? fail(new Error(`${name} failed (${code})`)) : ok())));
}

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  await new Promise((r) => setTimeout(r, 500));
  clearFetchCache();
  await replSet.stop().catch(() => undefined);
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

console.warn('[e2e] seeding');
await run('seed', [tsx, 'src/scripts/seed.ts'], resolve(root, 'apps/api'), apiEnv, { wait: true });
console.warn('[e2e] starting API and web');
run('api', [tsx, 'src/server.ts'], resolve(root, 'apps/api'), apiEnv);
const mode = process.env.E2E_WEB === 'start' ? 'start' : 'dev';
if (process.env.E2E_WEB !== 'none') run('web', [next, mode, '-p', String(WEB_PORT)], resolve(root, 'apps/web'), {
  ...process.env,
  API_URL: `http://127.0.0.1:${API_PORT}`,
  NEXT_PUBLIC_SITE_URL: `http://localhost:${WEB_PORT}`,
});
