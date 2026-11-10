import { type Permission, type RoleKey, type RoleScope, ROLE_RANK } from '@mb/shared';
import { Types } from 'mongoose';

export interface ActiveGrant {
  branch: string;
  permissions: Permission[];
  expiresAt: Date;
}

export interface AuthContextData {
  userId: string;
  sessionId: string;
  fullName: string;
  role: RoleKey;
  roleName: string;
  scope: RoleScope;
  rolePermissions: ReadonlySet<Permission>;
  /** Branches the user is assigned to (branch-scoped roles). */
  branches: string[];
  /** Cross-branch grants issued by a super admin. Only unexpired grants are loaded. */
  grants: ActiveGrant[];
  customerId: string | null;
  mustChangePassword: boolean;
}

/**
 * The authenticated caller. This is the single place where role permissions and
 * branch scope are combined, so every module asks the same questions in the same way.
 */
export class AuthContext {
  constructor(private readonly d: AuthContextData) {}

  get userId() { return this.d.userId; }
  get sessionId() { return this.d.sessionId; }
  get fullName() { return this.d.fullName; }
  get role() { return this.d.role; }
  get roleName() { return this.d.roleName; }
  get scope() { return this.d.scope; }
  get rank() { return ROLE_RANK[this.d.role]; }
  get branches() { return this.d.branches; }
  get grants() { return this.d.grants; }
  get customerId() { return this.d.customerId; }
  get mustChangePassword() { return this.d.mustChangePassword; }
  get isCompanyWide() { return this.d.scope === 'company'; }

  private activeGrants(): ActiveGrant[] {
    const now = Date.now();
    return this.d.grants.filter((g) => g.expiresAt.getTime() > now);
  }

  /** The permission comes from the user's role (in their own scope). */
  hasRolePermission(permission: Permission): boolean {
    return this.d.rolePermissions.has(permission);
  }

  /** The user may perform the action in at least one branch. */
  can(permission: Permission): boolean {
    return (
      this.hasRolePermission(permission) ||
      this.activeGrants().some((g) => g.permissions.includes(permission))
    );
  }

  /**
   * The branches where the user may exercise a permission:
   * 'ALL' for company-wide roles, otherwise assigned branches plus matching grants.
   */
  branchesFor(permission: Permission): 'ALL' | string[] {
    if (this.isCompanyWide && this.hasRolePermission(permission)) return 'ALL';
    const ids = new Set<string>();
    if (this.d.scope === 'branch' && this.hasRolePermission(permission)) {
      for (const b of this.d.branches) ids.add(b);
    }
    for (const g of this.activeGrants()) {
      if (g.permissions.includes(permission)) ids.add(g.branch);
    }
    return [...ids];
  }

  canAccessBranch(permission: Permission, branchId: string | Types.ObjectId | null | undefined): boolean {
    if (!branchId) return false;
    const scope = this.branchesFor(permission);
    return scope === 'ALL' || scope.includes(String(branchId));
  }

  /** Can act in every one of the given branches. */
  canAccessAllBranches(permission: Permission, branchIds: (string | Types.ObjectId)[]): boolean {
    const scope = this.branchesFor(permission);
    return scope === 'ALL' || branchIds.every((b) => scope.includes(String(b)));
  }

  /**
   * A MongoDB filter that restricts a query to the caller's branches.
   * Use it in every query on branch-owned data.
   */
  branchFilter(permission: Permission, field = 'branch'): Record<string, unknown> {
    const scope = this.branchesFor(permission);
    if (scope === 'ALL') return {};
    return { [field]: { $in: scope.map((id) => new Types.ObjectId(id)) } };
  }

  /** Role permissions plus permissions granted on other branches. */
  effectivePermissions(): Permission[] {
    const all = new Set<Permission>(this.d.rolePermissions);
    for (const g of this.activeGrants()) for (const p of g.permissions) all.add(p);
    return [...all].sort();
  }
}
