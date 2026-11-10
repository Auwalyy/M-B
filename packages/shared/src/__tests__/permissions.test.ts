import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  COMPANY_ONLY_PERMISSIONS,
  DEFAULT_ROLES,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
} from '../permissions';

describe('permission catalogue', () => {
  it('groups every permission exactly once', () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('never gives company-only permissions to branch-scoped default roles', () => {
    for (const role of DEFAULT_ROLES.filter((r) => r.scope !== 'company')) {
      for (const p of role.permissions) expect(COMPANY_ONLY_PERMISSIONS).not.toContain(p);
    }
  });

  it('gives the super admin every permission and customers none', () => {
    expect(DEFAULT_ROLES.find((r) => r.key === 'SUPER_ADMIN')?.permissions).toEqual(ALL_PERMISSIONS);
    expect(DEFAULT_ROLES.find((r) => r.key === 'CUSTOMER')?.permissions).toEqual([]);
  });

  it('has a readable label for every permission', () => {
    expect(PERMISSION_LABELS['inventory:approve-adjustment']).toBe('Approve adjustment inventory');
    for (const p of ALL_PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy();
  });
});
