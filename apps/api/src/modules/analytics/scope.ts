import { type BranchRef, type DateRange, PERMISSIONS, type Permission, addDays, daysInRange, defaultRange, lagosDay, lagosDayStart } from '@mb/shared';
import { Types } from 'mongoose';
import type { AuthContext } from '../../core/auth/AuthContext';
import { notFound } from '../../core/errors/AppError';
import { Branch } from '../branches/branch.model';

const P = PERMISSIONS;

/**
 * Which branches a report covers and which figures the caller may see.
 * Every analytics query starts here, so branch isolation is enforced in one place.
 */
export interface ReportScope {
  /** 'ALL' only for company-wide roles with no branch filter. */
  branchIds: Types.ObjectId[] | 'ALL';
  /** Set when the caller asked for one branch. */
  branch: BranchRef | null;
  /** Collected revenue, refunds, balances and payments. */
  financial: boolean;
  /** Inventory value at cost. */
  cost: boolean;
}

export async function resolveScope(auth: AuthContext, branch?: string): Promise<ReportScope> {
  let branchIds: ReportScope['branchIds'];
  let ref: BranchRef | null = null;
  if (branch) {
    // Out-of-scope and unknown branches look the same.
    if (!auth.canAccessBranch(P.REPORTS_READ, branch)) throw notFound('Branch');
    const b = await Branch.findById(branch).select('name code').lean();
    if (!b) throw notFound('Branch');
    branchIds = [b._id];
    ref = { id: b._id.toString(), name: b.name, code: b.code };
  } else {
    const s = auth.branchesFor(P.REPORTS_READ);
    branchIds = s === 'ALL' ? 'ALL' : s.map((id) => new Types.ObjectId(id));
  }
  const covers = (perm: Permission) => (branchIds === 'ALL' ? auth.branchesFor(perm) === 'ALL' : auth.canAccessAllBranches(perm, branchIds));
  return { branchIds, branch: ref, financial: covers(P.REPORTS_FINANCIAL), cost: covers(P.INVENTORY_READ_COST) };
}

/** A filter on the branch field for the scope. */
export function scopeMatch(scope: ReportScope, field = 'branch'): Record<string, unknown> {
  return scope.branchIds === 'ALL' ? {} : { [field]: { $in: scope.branchIds } };
}

export interface ResolvedRange extends DateRange {
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** Fills in a missing end of the range (30 days by default) and converts Lagos days to instants. */
export function resolveRange(q: { from?: string; to?: string }): ResolvedRange {
  const def = defaultRange();
  const to = q.to ?? (q.from ? (q.from > lagosDay() ? q.from : lagosDay()) : def.to);
  const from = q.from ?? addDays(to, -29);
  return { from, to, start: lagosDayStart(from), end: lagosDayStart(addDays(to, 1)) };
}

/** The same number of days immediately before the range. */
export function previousRange(r: ResolvedRange): ResolvedRange {
  const days = daysInRange(r.from, r.to);
  const to = addDays(r.from, -1);
  const from = addDays(to, -(days - 1));
  return { from, to, start: lagosDayStart(from), end: r.start };
}

export const plainRange = (r: ResolvedRange): DateRange => ({ from: r.from, to: r.to });
