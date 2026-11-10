import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/**
 * One in-memory replica set for the whole run. A replica set, not a standalone server,
 * so transactions behave exactly as in production. Each test file uses its own database.
 */
export default async function setup(project: TestProject) {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
