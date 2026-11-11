import {
  type EnquiryDto,
  PERMISSIONS,
  type listEnquiriesQuery,
  type publicEnquirySchema,
  type staffEnquirySchema,
  type updateEnquirySchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { env } from '../../config/env';
import type { AuthContext } from '../../core/auth/AuthContext';
import { nextReference } from '../../core/db/counter';
import { withTransaction } from '../../core/db/transaction';
import { badRequest, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { queueEmail } from '../../core/mail/mailer';
import { newEnquiryEmail } from '../../core/mail/templates';
import { audit } from '../audit/audit.service';
import { Branch } from '../branches/branch.model';
import { type IImage, Product } from '../catalog/catalog.models';
import { productRef } from '../catalog/catalog.service';
import { User } from '../users/user.model';
import { notifyBranchTeam } from '../notifications/notification.service';
import { CustomerInteraction, Enquiry, type IEnquiry } from './crm.models';
import { Customer } from './customer.model';
import { markServed } from './customer.service';

const P = PERMISSIONS;
const CHANNEL_LABEL = { web_form: 'website', whatsapp: 'WhatsApp', phone: 'phone', walk_in: 'walk-in' } as const;

type Populated = Omit<IEnquiry, 'branch' | 'customer' | 'product' | 'assignedTo' | 'createdBy' | 'notes'> & {
  _id: Types.ObjectId;
  branch: { _id: Types.ObjectId; name: string; code: string };
  customer: { _id: Types.ObjectId; fullName: string } | null;
  product: { _id: Types.ObjectId; name: string; sku: string; slug: string; images: IImage[] } | null;
  assignedTo: { _id: Types.ObjectId; fullName: string } | null;
  createdBy: { _id: Types.ObjectId; fullName: string } | null;
  notes: { text: string; by: { _id: Types.ObjectId; fullName: string } | null; at: Date }[];
};

const person = (u: { _id: Types.ObjectId; fullName: string } | null) => (u ? { id: u._id.toString(), fullName: u.fullName } : null);

function dto(e: Populated): EnquiryDto {
  return {
    id: e._id.toString(),
    reference: e.reference,
    branch: { id: e.branch._id.toString(), name: e.branch.name, code: e.branch.code },
    channel: e.channel,
    status: e.status,
    contact: { name: e.contact.name, phone: e.contact.phone, email: e.contact.email ?? null },
    customer: e.customer ? { id: e.customer._id.toString(), fullName: e.customer.fullName } : null,
    product: e.product ? productRef(e.product) : null,
    subject: e.subject,
    message: e.message,
    assignedTo: person(e.assignedTo),
    notes: e.notes.map((n) => ({ text: n.text, by: person(n.by), at: n.at.toISOString() })),
    createdBy: person(e.createdBy),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

async function load(id: Types.ObjectId | string): Promise<EnquiryDto> {
  const e = await Enquiry.findById(id)
    .populate('branch', 'name code')
    .populate('customer', 'fullName')
    .populate('product', 'name sku slug images')
    .populate('assignedTo', 'fullName')
    .populate('createdBy', 'fullName')
    .populate('notes.by', 'fullName')
    .lean<Populated>();
  if (!e) throw notFound('Enquiry');
  return dto(e);
}

type NewEnquiry = {
  branch: string;
  channel: IEnquiry['channel'];
  name: string;
  phone: string;
  email?: string;
  product?: string;
  subject: string;
  message: string;
  createdBy: string | null;
};

async function create(input: NewEnquiry, actor: AuthContext | null, meta: RequestMeta): Promise<Types.ObjectId> {
  const branch = await Branch.findOne({ _id: input.branch, status: 'active' }).select('name code').lean();
  if (!branch) throw badRequest('Choose one of our active branches.', { branch: ['Not available'] });
  if (input.product && !(await Product.exists({ _id: input.product, ...(actor ? {} : { status: 'active' }) }))) {
    throw badRequest('That product is not available.', { product: ['Not found'] });
  }

  return withTransaction(async () => {
    // Attach to the central customer record when the phone number is known.
    const customer = await Customer.findOne({ phone: input.phone }).select('_id').lean();
    const [e] = await Enquiry.create([
      {
        reference: await nextReference('ENQ', branch.code),
        branch: branch._id,
        channel: input.channel,
        contact: { name: input.name, phone: input.phone, email: input.email },
        customer: customer?._id ?? null,
        product: input.product ?? null,
        subject: input.subject,
        message: input.message,
        createdBy: input.createdBy,
      },
    ]);
    if (customer) {
      await CustomerInteraction.create([
        {
          customer: customer._id,
          branch: branch._id,
          channel: input.channel === 'web_form' ? 'email' : input.channel === 'walk_in' ? 'in_store' : input.channel,
          direction: 'inbound',
          summary: `Enquiry: ${input.subject}`,
          relatedTo: { kind: 'Enquiry', id: e!._id, label: e!.reference },
          recordedBy: input.createdBy,
        },
      ]);
      await markServed(customer._id, branch._id);
    }
    // Tell the branch team (branch admins with an email address).
    const admins = await User.find({ roleKey: 'BRANCH_ADMIN', status: 'active', branches: branch._id, email: { $type: 'string' } }).select('email fullName').lean();
    for (const a of admins) {
      await queueEmail(newEnquiryEmail(a.email!, a.fullName, { reference: e!.reference, branch: branch.name, channel: CHANNEL_LABEL[input.channel], name: input.name, subject: input.subject, link: `${env.WEB_URL}/admin/enquiries/${e!._id}` }));
    }
    await notifyBranchTeam(branch._id, P.ENQUIRIES_MANAGE, { type: 'enquiry.new', title: `New enquiry ${e!.reference}`, body: `${input.name}: ${input.subject}`, link: `/admin/enquiries/${e!._id}` });
    await audit({ action: 'enquiry.created', actor, branch: branch._id, entity: { kind: 'Enquiry', id: e!._id, label: e!.reference }, meta: { channel: input.channel } }, meta);
    return e!._id;
  });
}

/** Website contact form. Returns only the reference so the public cannot read enquiry data back. */
export async function createPublicEnquiry(input: z.output<typeof publicEnquirySchema>, meta: RequestMeta): Promise<{ reference: string }> {
  const id = await create({ ...input, channel: 'web_form', createdBy: null }, null, meta);
  const e = await Enquiry.findById(id).select('reference').lean();
  return { reference: e!.reference };
}

/** Staff log an enquiry that came in by WhatsApp, phone or in person. */
export async function createStaffEnquiry(auth: AuthContext, input: z.output<typeof staffEnquirySchema>, meta: RequestMeta): Promise<EnquiryDto> {
  if (!auth.canAccessBranch(P.ENQUIRIES_MANAGE, input.branch)) throw forbidden('You can only log enquiries for your own branches.');
  const id = await create({ ...input, createdBy: auth.userId }, auth, meta);
  return load(id);
}

export async function listEnquiries(auth: AuthContext, q: z.output<typeof listEnquiriesQuery>): Promise<Page<EnquiryDto>> {
  const filter: Record<string, unknown> = { ...auth.branchFilter(P.ENQUIRIES_READ) };
  if (q.branch) {
    if (!auth.canAccessBranch(P.ENQUIRIES_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.status) filter.status = q.status;
  if (q.channel) filter.channel = q.channel;
  if (q.assignedToMe) filter.assignedTo = new Types.ObjectId(auth.userId);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ reference: rx }, { 'contact.name': rx }, { 'contact.phone': rx }, { subject: rx }];
  }
  const [rows, total] = await Promise.all([
    Enquiry.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).select('_id'),
    Enquiry.countDocuments(filter),
  ]);
  return Page.of(await Promise.all(rows.map((r) => load(r._id))), total, q.page, q.limit);
}

export async function getEnquiry(auth: AuthContext, id: string): Promise<EnquiryDto> {
  const e = await Enquiry.findById(id).select('branch').lean();
  if (!e || !auth.canAccessBranch(P.ENQUIRIES_READ, e.branch)) throw notFound('Enquiry');
  return load(id);
}

export async function updateEnquiry(auth: AuthContext, id: string, input: z.output<typeof updateEnquirySchema>, meta: RequestMeta): Promise<EnquiryDto> {
  await withTransaction(async () => {
    const e = await Enquiry.findById(id);
    if (!e || !auth.canAccessBranch(P.ENQUIRIES_READ, e.branch)) throw notFound('Enquiry');
    if (!auth.canAccessBranch(P.ENQUIRIES_MANAGE, e.branch)) throw forbidden();
    const before = { status: e.status, assignedTo: e.assignedTo?.toString() ?? null };

    if (input.assignedTo !== undefined) {
      if (input.assignedTo) {
        const staff = await User.findOne({ _id: input.assignedTo, status: 'active', $or: [{ roleKey: 'SUPER_ADMIN' }, { branches: e.branch }] }).select('_id').lean();
        if (!staff) throw badRequest('Assign the enquiry to active staff of this branch.', { assignedTo: ['Not available'] });
      }
      e.assignedTo = input.assignedTo ? new Types.ObjectId(input.assignedTo) : null;
    }
    if (input.status) e.status = input.status;
    if (input.note) e.notes.push({ text: input.note, by: new Types.ObjectId(auth.userId), at: new Date() });
    if (e.status === 'new' && (input.note || input.assignedTo)) e.status = 'in_progress';
    await e.save();
    if (input.note && e.customer) {
      await CustomerInteraction.create([{ customer: e.customer, branch: e.branch, channel: 'system', direction: 'outbound', summary: input.note, relatedTo: { kind: 'Enquiry', id: e._id, label: e.reference }, recordedBy: auth.userId }]);
    }
    await audit({ action: 'enquiry.updated', actor: auth, branch: e.branch, entity: { kind: 'Enquiry', id: e._id, label: e.reference }, before, after: { status: e.status, assignedTo: e.assignedTo?.toString() ?? null }, meta: input.note ? { note: input.note } : undefined }, meta);
  });
  return load(id);
}
