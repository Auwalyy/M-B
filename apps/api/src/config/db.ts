import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

// Operations inside connection.transaction() automatically join the transaction session,
// so services cannot forget to pass `{ session }`.
mongoose.set('transactionAsyncLocalStorage', true);
// Reject query filters on fields that are not in the schema.
mongoose.set('strictQuery', true);

export async function connectDatabase(uri: string, dbName?: string): Promise<typeof mongoose> {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 10_000,
    // Production builds indexes in `npm run bootstrap` at deploy time, not on every start.
    autoIndex: !env.isProd,
  });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** True when the server is a replica set member (required for transactions). */
export async function supportsTransactions(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  const hello = await db.admin().command({ hello: 1 });
  return Boolean(hello.setName);
}
