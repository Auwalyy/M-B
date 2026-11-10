/**
 * Creates the first Super Admin on a fresh production database (or resets an existing one).
 *
 *   SUPER_ADMIN_NAME="..." SUPER_ADMIN_EMAIL="..." SUPER_ADMIN_PHONE="..." \
 *   SUPER_ADMIN_PASSWORD="..." npm run create-super-admin
 *
 * The account must change its password at first sign-in.
 */
import { email as emailSchema, password as passwordSchema, phone as phoneSchema, text } from '@mb/shared';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
import { hashPassword } from '../core/auth/password';
import { ensureSystemRoles, getRoleByKey } from '../modules/roles/role.service';
import { getSettingsDoc } from '../modules/settings/settings.service';
import { User } from '../modules/users/user.model';
import { audit } from '../modules/audit/audit.service';

const input = z
  .object({
    SUPER_ADMIN_NAME: text(120),
    SUPER_ADMIN_EMAIL: emailSchema,
    SUPER_ADMIN_PHONE: phoneSchema,
    SUPER_ADMIN_PASSWORD: passwordSchema,
  })
  .parse(process.env);

async function main() {
  await connectDatabase(env.MONGODB_URI);
  await ensureSystemRoles();
  await getSettingsDoc();
  const role = await getRoleByKey('SUPER_ADMIN');
  const user = await User.findOneAndUpdate(
    { email: input.SUPER_ADMIN_EMAIL },
    {
      $set: {
        fullName: input.SUPER_ADMIN_NAME,
        phone: input.SUPER_ADMIN_PHONE,
        passwordHash: await hashPassword(input.SUPER_ADMIN_PASSWORD),
        role: role._id,
        roleKey: 'SUPER_ADMIN',
        branches: [],
        status: 'active',
        mustChangePassword: true,
        failedLoginCount: 0,
      },
      $unset: { lockedUntil: 1 },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  await audit({ action: 'user.super_admin_bootstrapped', entity: { kind: 'User', id: user._id, label: user.fullName } });
  console.warn(`Super Admin ready: ${user.email}. They must change the password at first sign-in.`);
}

main()
  .catch((err) => {
    console.error(err instanceof z.ZodError ? z.prettifyError(err) : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
