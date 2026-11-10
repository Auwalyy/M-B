/**
 * Runs a persistent single-node MongoDB replica set for local development without Docker.
 * Data is kept in apps/api/.data/mongo. The MongoDB binary downloads on first run (~100 MB).
 *
 *   npm run db:dev
 *
 * Then set MONGODB_URI=mongodb://127.0.0.1:27017/mudassir?replicaSet=rs0 in apps/api/.env.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const { MongoClient } = mongoose.mongo;

const dbPath = resolve(process.cwd(), '.data/mongo');
mkdirSync(dbPath, { recursive: true });
const port = Number(process.env.DEV_DB_PORT ?? 27017);
const host = `127.0.0.1:${port}`;

const server = await MongoMemoryServer.create({
  instance: { port, dbPath, storageEngine: 'wiredTiger', replSet: 'rs0' },
});

// Initiate the replica set on first run. The config persists in dbPath, so later runs skip this.
const client = new MongoClient(`mongodb://${host}/?directConnection=true`);
await client.connect();
const admin = client.db('admin');
try {
  await admin.command({ replSetGetStatus: 1 });
} catch {
  await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host }] } });
}
for (let i = 0; i < 60; i++) {
  const hello = await admin.command({ hello: 1 });
  if (hello.isWritablePrimary) break;
  await new Promise((r) => setTimeout(r, 500));
}
await client.close();

console.warn(`MongoDB replica set ready: mongodb://${host}/mudassir?replicaSet=rs0`);
console.warn(`Data directory: ${dbPath}`);
console.warn('Press Ctrl+C to stop.');

const stop = async () => {
  await server.stop({ doCleanup: false, force: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
