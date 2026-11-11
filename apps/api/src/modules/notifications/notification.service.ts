import { createHmac, timingSafeEqual } from 'node:crypto';
import { type NotificationDto, type Permission, toWhatsAppNumber } from '@mb/shared';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { AuthContext } from '../../core/auth/AuthContext';
import { enqueue, registerOutboxHandler } from '../../core/events/outbox';
import { notFound } from '../../core/errors/AppError';
import { Page, skipFor } from '../../core/http/pagination';
import { queueEmail } from '../../core/mail/mailer';
import { simpleEmail } from '../../core/mail/templates';
import { Customer } from '../customers/customer.model';
import { Role } from '../roles/role.model';
import { User } from '../users/user.model';
import { MessageLog, Notification } from './notification.models';

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  /** Path in the web app, e.g. /admin/orders/123. */
  link?: string | null;
  branch?: Types.ObjectId | string | null;
  /** Also send an email (to recipients with an address). */
  email?: boolean;
}

/** In-app (and optionally email) notification for specific users. Joins the caller's transaction. */
export async function notifyUsers(userIds: (Types.ObjectId | string)[], n: NotificationInput): Promise<void> {
  const ids = [...new Set(userIds.map(String))];
  if (!ids.length) return;
  await Notification.insertMany(ids.map((id) => ({ recipient: id, type: n.type, title: n.title, body: n.body, link: n.link ?? null, branch: n.branch ?? null })));
  if (n.email) {
    const users = await User.find({ _id: { $in: ids }, status: 'active', email: { $type: 'string' } }).select('email fullName').lean();
    for (const u of users) await queueEmail(simpleEmail(u.email!, u.fullName, n.title, n.body, n.link ? `${env.WEB_URL}${n.link}` : null));
  }
}

/**
 * Staff of a branch who hold a permission (e.g. everyone who can review reservations),
 * plus super admins when `includeHeadOffice` is set.
 */
export async function notifyBranchTeam(branch: Types.ObjectId | string, permission: Permission, n: NotificationInput, includeHeadOffice = false): Promise<void> {
  const roles = await Role.find({ permissions: permission }).select('key scope').lean();
  const branchRoles = roles.filter((r) => r.scope === 'branch').map((r) => r.key);
  const companyRoles = includeHeadOffice ? roles.filter((r) => r.scope === 'company').map((r) => r.key) : [];
  const users = await User.find({
    status: 'active',
    $or: [
      { roleKey: { $in: branchRoles }, branches: new Types.ObjectId(String(branch)) },
      ...(companyRoles.length ? [{ roleKey: { $in: companyRoles } }] : []),
    ],
  }).select('_id').lean();
  await notifyUsers(users.map((u) => u._id), { ...n, branch });
}

/** Everyone holding a company-wide permission (e.g. transfer approvers). */
export async function notifyHeadOffice(permission: Permission, n: NotificationInput): Promise<void> {
  const roles = await Role.find({ permissions: permission, scope: 'company' }).select('key').lean();
  const users = await User.find({ status: 'active', roleKey: { $in: roles.map((r) => r.key) } }).select('_id').lean();
  await notifyUsers(users.map((u) => u._id), n);
}

/**
 * A customer: in-app if they have an online account; email if we have an address
 * (from the order or reservation contact); WhatsApp template when the Cloud API is configured.
 */
export async function notifyCustomer(
  customerId: Types.ObjectId | string,
  n: NotificationInput & { contactEmail?: string | null; whatsapp?: { template: 'order' | 'reservation'; params: string[]; related: { kind: string; id: Types.ObjectId } } },
): Promise<void> {
  const c = await Customer.findById(customerId).select('user email phone fullName').lean();
  if (!c) return;
  if (c.user) await Notification.create([{ recipient: c.user, type: n.type, title: n.title, body: n.body, link: n.link ?? null, branch: n.branch ?? null }]);
  const to = n.contactEmail ?? c.email;
  if (n.email !== false && to) await queueEmail(simpleEmail(to, c.fullName, n.title, n.body, n.link ? `${env.WEB_URL}${n.link}` : null));
  if (n.whatsapp && env.whatsappEnabled) {
    const template = n.whatsapp.template === 'order' ? env.WHATSAPP_TEMPLATE_ORDER_UPDATE : env.WHATSAPP_TEMPLATE_RESERVATION_UPDATE;
    const [log] = await MessageLog.create([{ channel: 'whatsapp', to: c.phone, template, params: n.whatsapp.params, related: n.whatsapp.related }]);
    await enqueue('whatsapp.send', { messageLogId: log!._id.toString() });
  }
}

// ------------------------------------------------------------------ WhatsApp Cloud API

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests replace the HTTP client. */
export function setWhatsAppFetch(f: typeof fetch): void {
  fetchImpl = f;
}

registerOutboxHandler('whatsapp.send', async (payload) => {
  const log = await MessageLog.findById(String(payload.messageLogId));
  if (!log || log.status !== 'queued') return;
  if (!env.whatsappEnabled) {
    log.status = 'failed';
    log.error = 'WhatsApp Cloud API is not configured';
    await log.save();
    return;
  }
  const res = await fetchImpl(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toWhatsAppNumber(log.to),
      type: 'template',
      template: {
        name: log.template,
        language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{ type: 'body', parameters: log.params.map((text) => ({ type: 'text', text })) }],
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok || !body.messages?.[0]?.id) {
    log.status = 'failed';
    log.error = body.error?.message?.slice(0, 300) ?? `HTTP ${res.status}`;
    await log.save();
    // A 4xx is permanent (bad number, unapproved template); retry only server errors.
    if (res.status >= 500) throw new Error(log.error);
    return;
  }
  // Accepted by Meta. Delivery is confirmed later by the status webhook, never assumed here.
  log.status = 'accepted';
  log.providerMessageId = body.messages[0].id;
  await log.save();
});

/** Meta signs webhook bodies with the app secret (X-Hub-Signature-256). */
export function verifyWhatsAppSignature(raw: Buffer | undefined, header: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET || !raw || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
}

const STATUS_RANK = { queued: 0, accepted: 1, sent: 2, delivered: 3, read: 4, failed: 5 } as const;

/** Applies delivery receipts from Meta. Statuses only move forward. */
export async function applyWhatsAppStatuses(body: unknown): Promise<number> {
  const statuses: { id: string; status: string }[] = [];
  for (const entry of (body as { entry?: { changes?: { value?: { statuses?: { id: string; status: string }[] } }[] }[] })?.entry ?? []) {
    for (const ch of entry.changes ?? []) statuses.push(...(ch.value?.statuses ?? []));
  }
  let updated = 0;
  for (const s of statuses) {
    if (!(s.status in STATUS_RANK)) continue;
    const log = await MessageLog.findOne({ providerMessageId: s.id });
    if (!log) continue;
    const next = s.status as keyof typeof STATUS_RANK;
    if (next === 'failed' || STATUS_RANK[next] > STATUS_RANK[log.status]) {
      log.status = next;
      await log.save();
      updated++;
    }
  }
  if (statuses.length) logger.debug({ updated }, 'WhatsApp statuses applied');
  return updated;
}

// ------------------------------------------------------------------ reading notifications

export async function listNotifications(auth: AuthContext, page: number, limit: number, unread?: boolean): Promise<Page<NotificationDto>> {
  const filter = { recipient: new Types.ObjectId(auth.userId), ...(unread ? { readAt: null } : {}) };
  const [rows, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);
  return Page.of(
    rows.map((n) => ({ id: n._id.toString(), type: n.type, title: n.title, body: n.body, link: n.link ?? null, read: Boolean(n.readAt), createdAt: n.createdAt.toISOString() })),
    total,
    page,
    limit,
  );
}

export async function unreadCount(auth: AuthContext): Promise<{ count: number }> {
  return { count: await Notification.countDocuments({ recipient: auth.userId, readAt: null }) };
}

export async function markRead(auth: AuthContext, id: string): Promise<void> {
  const res = await Notification.updateOne({ _id: id, recipient: auth.userId }, { $set: { readAt: new Date() } });
  if (res.matchedCount === 0) throw notFound('Notification');
}

export async function markAllRead(auth: AuthContext): Promise<{ updated: number }> {
  const res = await Notification.updateMany({ recipient: auth.userId, readAt: null }, { $set: { readAt: new Date() } });
  return { updated: res.modifiedCount };
}
