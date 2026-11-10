import mongoose from 'mongoose';

/**
 * Runs `fn` in a MongoDB transaction. Because `transactionAsyncLocalStorage` is enabled,
 * every Mongoose operation inside `fn` joins the transaction automatically.
 * Transient errors (write conflicts) are retried by the driver.
 */
export function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(fn);
}
