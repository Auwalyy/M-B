import { hash, verify } from '@node-rs/argon2';
import { env } from '../../config/env';

// argon2id, OWASP-recommended parameters (19 MiB memory, 2 iterations).
// Tests use cheap parameters only to keep the suite fast; verify() reads the parameters from the hash.
const OPTIONS = env.isTest
  ? ({ memoryCost: 1024, timeCost: 1, parallelism: 1 } as const)
  : ({ memoryCost: 19456, timeCost: 2, parallelism: 1 } as const);

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spend the same time verifying a password when the account does not exist,
 * so response timing does not reveal which emails or phones are registered.
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-1');
  await verifyPassword(await dummyHash, plain);
}
