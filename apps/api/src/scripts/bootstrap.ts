/**
 * Prepares a database for this release. Safe to run on every deploy, before the new API starts:
 *
 *   npm run bootstrap            (from source)
 *   npm run bootstrap:prod       (from the built dist/, on the server)
 *
 * It checks the database supports transactions, builds every index the models declare
 * (and drops ones no longer declared), makes sure the system roles and company settings exist,
 * and reports whether a Super Admin has been created yet. It never deletes business data.
 */
import mongoose from 'mongoose';
import '../app'; // registers every model
import { connectDatabase, disconnectDatabase, supportsTransactions } from '../config/db';
import { env } from '../config/env';
import { ensureSystemRoles } from '../modules/roles/role.service';
import { getSettingsDoc } from '../modules/settings/settings.service';
import { User } from '../modules/users/user.model';

async function main() {
  await connectDatabase(env.MONGODB_URI);
  if (!(await supportsTransactions())) {
    throw new Error('MongoDB must run as a replica set (Atlas always does). Transactions are required to prevent overselling.');
  }

  const names = mongoose.modelNames().sort();
  for (const name of names) {
    const dropped = await mongoose.model(name).syncIndexes();
    const count = (await mongoose.model(name).listIndexes()).length;
    console.warn(`  ${name.padEnd(22)} ${count} indexes${dropped.length ? ` (dropped stale: ${dropped.join(', ')})` : ''}`);
  }
  await ensureSystemRoles();
  await getSettingsDoc();

  const owners = await User.countDocuments({ roleKey: 'SUPER_ADMIN', status: 'active' });
  console.warn(`\nIndexes, roles and settings are ready (${names.length} collections).`);
  console.warn(owners ? `${owners} active Super Admin account(s).` : 'No Super Admin yet: run create-super-admin (see docs/DEPLOYMENT.md).');
}

main()
  .then(() => disconnectDatabase())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await disconnectDatabase().catch(() => undefined);
    process.exit(1);
  });
