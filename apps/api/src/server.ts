import { createApp } from './app';
import { connectDatabase, disconnectDatabase, supportsTransactions } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { startOutboxWorker, stopOutboxWorker } from './core/events/outbox';
import { assertStorageConfigured, getStorage } from './core/storage/storage';
import { ensureSystemRoles } from './modules/roles/role.service';
import { getSettingsDoc } from './modules/settings/settings.service';

async function main() {
  assertStorageConfigured();
  await connectDatabase(env.MONGODB_URI);
  if (!(await supportsTransactions())) {
    throw new Error(
      'MongoDB must run as a replica set (transactions are required to prevent overselling). ' +
        'Use MongoDB Atlas, `npm run db:dev`, or `docker compose up mongo`.',
    );
  }
  await ensureSystemRoles();
  await getSettingsDoc();
  startOutboxWorker();
  logger.info({ storage: getStorage().name }, 'Image storage ready');

  const { app } = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}${env.apiDocsEnabled ? ` (docs: /api/docs)` : ''}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopOutboxWorker();
    server.close(() => {
      disconnectDatabase()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
