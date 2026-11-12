import { ENQUIRY_CHANNELS, ENQUIRY_STATUSES, type EnquiryChannel, type EnquiryStatus, INTERACTION_CHANNELS, type SegmentFilter } from '@mb/shared';
import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

// ------------------------------------------------------------------ Communication history

export interface ICustomerInteraction {
  customer: Types.ObjectId;
  branch?: Types.ObjectId | null;
  channel: (typeof INTERACTION_CHANNELS)[number];
  direction: 'inbound' | 'outbound';
  summary: string;
  relatedTo?: { kind: string; id: Types.ObjectId; label?: string } | null;
  recordedBy?: Types.ObjectId | null;
  createdAt: Date;
}

const interactionSchema = new Schema<ICustomerInteraction>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    channel: { type: String, enum: INTERACTION_CHANNELS, required: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    summary: { type: String, required: true, maxlength: 1000 },
    relatedTo: { kind: String, id: Schema.Types.ObjectId, label: String },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
interactionSchema.index({ customer: 1, createdAt: -1 });

export const CustomerInteraction = model<ICustomerInteraction>('CustomerInteraction', interactionSchema);

// ------------------------------------------------------------------ Segments

export interface ICustomerSegment {
  name: string;
  description?: string;
  filter: SegmentFilter;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const segmentSchema = new Schema<ICustomerSegment>(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 300 },
    filter: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, minimize: false },
);

export const CustomerSegment = model<ICustomerSegment>('CustomerSegment', segmentSchema);

// ------------------------------------------------------------------ Enquiries

export interface IEnquiry {
  reference: string;
  branch: Types.ObjectId;
  channel: EnquiryChannel;
  status: EnquiryStatus;
  contact: { name: string; phone: string; email?: string };
  customer?: Types.ObjectId | null;
  product?: Types.ObjectId | null;
  subject: string;
  message: string;
  assignedTo?: Types.ObjectId | null;
  notes: { text: string; by: Types.ObjectId | null; at: Date }[];
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const enquirySchema = new Schema<IEnquiry>(
  {
    reference: { type: String, required: true, unique: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    channel: { type: String, enum: ENQUIRY_CHANNELS, required: true },
    status: { type: String, enum: ENQUIRY_STATUSES, default: 'new' },
    contact: {
      name: { type: String, required: true, maxlength: 120 },
      phone: { type: String, required: true },
      email: String,
    },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    subject: { type: String, required: true, maxlength: 150 },
    message: { type: String, required: true, maxlength: 2000 },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: [new Schema({ text: { type: String, required: true, maxlength: 1000 }, by: { type: Schema.Types.ObjectId, ref: 'User', default: null }, at: { type: Date, required: true } }, { _id: false })],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
enquirySchema.index({ branch: 1, status: 1, createdAt: -1 });
enquirySchema.index({ status: 1, createdAt: -1 });
enquirySchema.index({ assignedTo: 1, status: 1 });
enquirySchema.index({ customer: 1, createdAt: -1 });
enquirySchema.index({ 'contact.phone': 1 });

export const Enquiry = model<IEnquiry>('Enquiry', enquirySchema);
export type EnquiryDoc = HydratedDocument<IEnquiry>;
