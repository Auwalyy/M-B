import { Schema, model } from 'mongoose';

interface ICounter {
  _id: string;
  seq: number;
}

const Counter = model<ICounter>(
  'Counter',
  new Schema<ICounter>({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false }),
);

/** Atomically increments and returns the next number for a key (safe under concurrency). */
export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  return doc!.seq;
}

/**
 * Human-readable references such as ORD-KAN01-260001. Numbers restart each year
 * and are unique per prefix and branch.
 */
export async function nextReference(prefix: string, branchCode: string, now = new Date()): Promise<string> {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const key = `${prefix}-${branchCode}-${yy}`;
  const seq = await nextSequence(key);
  return `${key}${String(seq).padStart(4, '0')}`;
}
