import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import '../src/app'; // registers every model
import { connectDatabase } from '../src/config/db';
import { testMailbox } from '../src/core/mail/mailer';
import { ensureSystemRoles } from '../src/modules/roles/role.service';
import { setStorage } from '../src/core/storage/storage';
import { FakeStorage } from './fakeStorage';

/** Shared fake image storage; tests can inspect it through getStorage(). */
export const fakeStorage = new FakeStorage();
setStorage(fakeStorage);

beforeAll(async () => {
  await connectDatabase(inject('mongoUri'), `test_${randomUUID().slice(0, 8)}`);
  // Build indexes (unique constraints) before any test runs.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
});

beforeEach(async () => {
  // Native deleteMany skips Mongoose middleware (audit logs are append-only through Mongoose).
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  testMailbox.length = 0;
  fakeStorage.uploads.length = 0;
  fakeStorage.removed.length = 0;
  await ensureSystemRoles();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
