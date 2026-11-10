import type { AuthUserDto } from '@mb/shared';

/** Where a user lands after signing in. */
export function homeFor(user: Pick<AuthUserDto, 'role' | 'mustChangePassword'>): string {
  if (user.mustChangePassword) return '/change-password';
  return user.role === 'CUSTOMER' ? '/account' : '/admin';
}

/** Only allow same-site relative redirects (prevents open-redirect attacks via ?next=). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}
