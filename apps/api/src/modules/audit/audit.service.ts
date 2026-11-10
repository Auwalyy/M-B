import { type AuditLogDto, PERMISSIONS, type listAuditQuery } from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { forbidden } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { logger } from '../../config/logger';
import { AuditLog } from './audit.model';

const SENSITIVE_KEYS = new Set([
  'password', 'passwordHash', 'temporaryPassword', 'currentPassword', 'newPassword',
  'token', 'tokenHash', 'previousTokenHash', 'secret', 'accessToken', 'refreshToken',
]);

/** Deep copy with secrets removed, safe to store in the audit log. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 6) return value;
  if (value instanceof Types.ObjectId) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const src = typeof (value as { toObject?: unknown }).toObject === 'function'
      ? (value as { toObject: () => Record<string, unknown> }).toObject()
      : (value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === '__v') continue;
      out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Keep only the listed fields, for compact before/after snapshots. */
export function pick(source: unknown, fields: readonly string[]): Record<string, unknown> {
  const obj = redact(source) as Record<string, unknown>;
  return Object.fromEntries(fields.filter((f) => f in obj).map((f) => [f, obj[f]]));
}

export interface AuditEntry {
  action: string;
  actor?: AuthContext | { userId: string; role: string } | null;
  branch?: string | Types.ObjectId | null;
  entity?: { kind: string; id?: string | Types.ObjectId; label?: string };
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Write an audit entry. Inside a transaction it joins the transaction (through async local storage),
 * so the audit record is committed together with the change it describes.
 */
export async function audit(entry: AuditEntry, req?: RequestMeta): Promise<void> {
  const actor = entry.actor
    ? 'userId' in entry.actor
      ? { id: entry.actor.userId, role: entry.actor.role }
      : null
    : null;
  try {
    await AuditLog.create([
      {
        action: entry.action,
        actor: actor?.id,
        actorRole: actor?.role,
        branch: entry.branch ?? undefined,
        entity: entry.entity,
        before: entry.before === undefined ? undefined : redact(entry.before),
        after: entry.after === undefined ? undefined : redact(entry.after),
        meta: entry.meta === undefined ? undefined : redact(entry.meta),
        ip: req?.ip,
        userAgent: req?.userAgent,
        requestId: req?.requestId,
      },
    ]);
  } catch (err) {
    // Inside a transaction the error must propagate so the business change rolls back too.
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
    throw err;
  }
}

type ListQuery = z.output<typeof listAuditQuery>;

interface PopulatedAudit {
  _id: Types.ObjectId;
  actor?: { _id: Types.ObjectId; fullName: string } | null;
  actorRole?: string;
  action: string;
  branch?: { _id: Types.ObjectId; name: string; code: string } | null;
  entity?: { kind: string; id?: Types.ObjectId; label?: string };
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  createdAt: Date;
}

function toDto(a: PopulatedAudit): AuditLogDto {
  return {
    id: a._id.toString(),
    actor: a.actor ? { id: a.actor._id.toString(), fullName: a.actor.fullName } : null,
    actorRole: a.actorRole ?? null,
    action: a.action,
    branch: a.branch ? { id: a.branch._id.toString(), name: a.branch.name, code: a.branch.code } : null,
    entity: a.entity?.kind
      ? { kind: a.entity.kind, id: a.entity.id?.toString() ?? null, label: a.entity.label ?? null }
      : null,
    before: a.before ?? null,
    after: a.after ?? null,
    meta: a.meta ?? null,
    ip: a.ip ?? null,
    userAgent: a.userAgent ?? null,
    requestId: a.requestId ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function listAuditLogs(auth: AuthContext, q: ListQuery, loginsOnly = false): Promise<Page<AuditLogDto>> {
  const filter: Record<string, unknown> = {};
  if (loginsOnly) {
    if (!auth.can(PERMISSIONS.AUDIT_READ_LOGINS)) throw forbidden();
    filter.action = { $regex: '^auth\\.' };
  } else {
    // Branch admins see only entries tied to their branches.
    Object.assign(filter, auth.branchFilter(PERMISSIONS.AUDIT_READ));
  }
  if (q.action) {
    // "branch." or "password*" filter by prefix; anything else is an exact action name.
    const raw = loginsOnly ? `auth.${q.action.replace(/^auth\./, '')}` : q.action;
    const isPrefix = raw.endsWith('.') || raw.endsWith('*');
    const value = raw.replace(/\*$/, '');
    filter.action = isPrefix ? { $regex: `^${escapeRegex(value)}` } : value;
  } else if (!loginsOnly) {
    // Sign-in events have their own view; keep the change log readable.
    filter.action = { $not: /^auth\./ };
  }
  if (q.actor) filter.actor = new Types.ObjectId(q.actor);
  if (q.branch) {
    if (!loginsOnly && !auth.canAccessBranch(PERMISSIONS.AUDIT_READ, q.branch)) {
      return Page.of([], 0, q.page, q.limit);
    }
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.entityKind) filter['entity.kind'] = q.entityKind;
  if (q.entityId) filter['entity.id'] = new Types.ObjectId(q.entityId);
  if (q.from || q.to) {
    filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit)
      .populate('actor', 'fullName')
      .populate('branch', 'name code')
      .lean<PopulatedAudit[]>(),
    AuditLog.countDocuments(filter),
  ]);
  return Page.of(items.map(toDto), total, q.page, q.limit);
}
