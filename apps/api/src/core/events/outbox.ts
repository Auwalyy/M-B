import { hostname } from 'node:os';
import { Schema, model } from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

/**
 * Transactional outbox. Side effects such as emails are written here in the same
 * transaction as the business change, then delivered by a worker. A notification
 * therefore goes out only when the change succeeded, and survives crashes.
 */
export interface IOutboxEvent {
  type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  nextAttemptAt: Date;
  lockedUntil?: Date;
  lockedBy?: string;
  lastError?: string;
  processedAt?: Date;
  createdAt: Date;
}

const outboxSchema = new Schema<IOutboxEvent>(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lockedUntil: Date,
    lockedBy: String,
    lastError: String,
    processedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
outboxSchema.index({ status: 1, nextAttemptAt: 1 });
// Completed events are kept for 30 days for troubleshooting.
outboxSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const OutboxEvent = model<IOutboxEvent>('OutboxEvent', outboxSchema);

type Handler = (payload: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();

export function registerOutboxHandler(type: string, handler: Handler): void {
  handlers.set(type, handler);
}

/** Queue an event. Call it inside the same transaction as the business change. */
export async function enqueue(type: string, payload: Record<string, unknown>): Promise<void> {
  await OutboxEvent.create([{ type, payload }]);
}

const MAX_ATTEMPTS = 8;
const LOCK_MS = 60_000;
const workerId = `${hostname()}:${process.pid}`;

/** Claims and processes up to `limit` due events. Returns how many were processed. */
export async function processOutboxBatch(limit = 20): Promise<number> {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    // Atomic claim: also reclaims events whose worker crashed (lock expired).
    const event = await OutboxEvent.findOneAndUpdate(
      {
        $or: [
          { status: 'pending', nextAttemptAt: { $lte: now } },
          { status: 'processing', lockedUntil: { $lt: now } },
        ],
      },
      { $set: { status: 'processing', lockedUntil: new Date(now.getTime() + LOCK_MS), lockedBy: workerId }, $inc: { attempts: 1 } },
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
    );
    if (!event) break;
    processed++;
    const handler = handlers.get(event.type);
    try {
      if (!handler) throw new Error(`No handler registered for outbox event "${event.type}"`);
      await handler(event.payload);
      await OutboxEvent.updateOne(
        { _id: event._id },
        { $set: { status: 'done', processedAt: new Date() }, $unset: { lockedUntil: 1, lockedBy: 1, lastError: 1 } },
      );
    } catch (err) {
      const failed = event.attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(2 ** event.attempts * 1000, 60 * 60 * 1000);
      logger.warn({ err, eventId: event._id, type: event.type, attempts: event.attempts }, 'Outbox event failed');
      await OutboxEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: failed ? 'failed' : 'pending',
            nextAttemptAt: new Date(Date.now() + backoffMs),
            lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
          },
          $unset: { lockedUntil: 1, lockedBy: 1 },
        },
      );
    }
  }
  return processed;
}

let timer: NodeJS.Timeout | undefined;
let running = false;

export function startOutboxWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    processOutboxBatch()
      .catch((err) => logger.error({ err }, 'Outbox worker error'))
      .finally(() => {
        running = false;
      });
  }, env.OUTBOX_POLL_MS);
  timer.unref();
}

export function stopOutboxWorker(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
