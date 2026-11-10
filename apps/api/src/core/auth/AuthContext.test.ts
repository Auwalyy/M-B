import type { Permission } from '@mb/shared';
import { describe, expect, it } from 'vitest';
import { AuthContext } from './AuthContext';

const KANO = '64b000000000000000000001';
const ABUJA = '64b000000000000000000002';

function ctx(overrides: Partial<ConstructorParameters<typeof AuthContext>[0]> = {}) {
  return new AuthContext({
    userId: '64a000000000000000000001',
    sessionId: '64c000000000000000000001',
    fullName: 'Test',
    role: 'BRANCH_ADMIN',
    roleName: 'Branch Admin',
    scope: 'branch',
    rolePermissions: new Set<Permission>(['users:read', 'orders:read']),
    branches: [KANO],
    grants: [],
    customerId: null,
    mustChangePassword: false,
    ...overrides,
  });
}

describe('AuthContext', () => {
  it('limits branch-scoped roles to their assigned branches', () => {
    const a = ctx();
    expect(a.branchesFor('users:read')).toEqual([KANO]);
    expect(a.canAccessBranch('users:read', KANO)).toBe(true);
    expect(a.canAccessBranch('users:read', ABUJA)).toBe(false);
    expect(a.branchFilter('users:read')).toEqual({ branch: { $in: [expect.objectContaining({})] } });
  });

  it('returns no branches for a permission the role lacks', () => {
    const a = ctx();
    expect(a.can('payments:refund')).toBe(false);
    expect(a.branchesFor('payments:refund')).toEqual([]);
  });

  it('gives company-scoped roles every branch', () => {
    const a = ctx({ role: 'SUPER_ADMIN', scope: 'company', branches: [] });
    expect(a.branchesFor('users:read')).toBe('ALL');
    expect(a.branchFilter('users:read')).toEqual({});
    expect(a.canAccessAllBranches('users:read', [KANO, ABUJA])).toBe(true);
  });

  it('adds granted branches only for the granted permissions, and ignores expired grants', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    const a = ctx({
      grants: [
        { branch: ABUJA, permissions: ['orders:read'], expiresAt: future },
        { branch: '64b000000000000000000003', permissions: ['users:read'], expiresAt: past },
      ],
    });
    expect(a.branchesFor('orders:read')).toEqual([KANO, ABUJA]);
    expect(a.branchesFor('users:read')).toEqual([KANO]);
    expect(a.canAccessAllBranches('orders:read', [KANO, ABUJA])).toBe(true);
    expect(a.canAccessAllBranches('users:read', [KANO, ABUJA])).toBe(false);
  });

  it('lets a grant confer a permission outside the role (used only through validated grants)', () => {
    const a = ctx({ grants: [{ branch: ABUJA, permissions: ['inventory:read'], expiresAt: new Date(Date.now() + 60_000) }] });
    expect(a.can('inventory:read')).toBe(true);
    expect(a.branchesFor('inventory:read')).toEqual([ABUJA]);
    expect(a.effectivePermissions()).toEqual(['inventory:read', 'orders:read', 'users:read']);
  });

  it('gives customers (self scope) no branches', () => {
    const a = ctx({ role: 'CUSTOMER', scope: 'self', rolePermissions: new Set(), branches: [] });
    expect(a.branchesFor('orders:read')).toEqual([]);
  });
});
