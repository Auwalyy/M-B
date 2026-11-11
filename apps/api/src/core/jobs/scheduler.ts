import { hostname } from 'node:os';
import { Schema, model } from 'mongoose';
import { logger } from '../../config/logger';

/**
 * Minimal job scheduler. Each run first takes a lease in MongoDB, so with several API
 * instances only one runs a given job at a time. A crashed holder's lease simply expires.
 */
const JobLock = model<{ _id: string; lockedUntil: Date; owner: string; lastRunAt?: Date; lastResult?: string }>(
  'JobLock',
  new Schema({ _id: String, lockedUntil: Date, owner: String, lastRunAt: Date, lastResult: String }, { versionKey: false }),
);

const owner = `${hostname()}:${process.pid}`;

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<number | void>;
}
const jobs: Job[] = [];
const timers: NodeJS.Timeout[] = [];

export function registerJob(name: string, everyMs: number, run: Job['run']): void {
  jobs.push({ name, everyMs, run });
}

async function tryLease(name: string, ms: number): Promise<boolean> {
  const now = new Date();
  try {
    const res = await JobLock.findOneAndUpdate(
      { _id: name, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
      { $set: { lockedUntil: new Date(now.getTime() + ms), owner } },
      { upsert: true, returnDocument: 'after' },
    );
    return res?.owner === owner;
  } catch (err) {
    // A duplicate key here means another instance holds the lease.
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

/** Runs one job now (if the lease is free). Exposed for tests and manual runs. */
export async function runJob(name: string): Promise<number | void | 'skipped'> {
  const job = jobs.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job ${name}`);
  if (!(await tryLease(name, Math.max(job.everyMs, 60_000)))) return 'skipped';
  try {
    const result = await job.run();
    await JobLock.updateOne({ _id: name }, { $set: { lastRunAt: new Date(), lastResult: String(result ?? 'ok'), lockedUntil: new Date() } });
    if (result) logger.info({ job: name, result }, 'Job finished');
    return result;
  } catch (err) {
    logger.error({ err, job: name }, 'Job failed');
    await JobLock.updateOne({ _id: name }, { $set: { lastRunAt: new Date(), lastResult: 'error', lockedUntil: new Date() } });
    return undefined;
  }
}

export function startJobs(): void {
  for (const job of jobs) {
    const t = setInterval(() => void runJob(job.name), job.everyMs);
    t.unref();
    timers.push(t);
  }
  logger.info({ jobs: jobs.map((j) => j.name) }, 'Background jobs started');
}

export function stopJobs(): void {
  for (const t of timers.splice(0)) clearInterval(t);
}
