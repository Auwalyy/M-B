import { Schema, type Types, model } from 'mongoose';

/** In-app notification for one user. */
export interface INotification {
  recipient: Types.ObjectId;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  branch?: Types.ObjectId | null;
  readAt?: Date | null;
  createdAt: Date;
}
const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, required: true, maxlength: 600 },
    link: { type: String, default: null },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
// Old notifications are removed after 180 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });
export const Notification = model<INotification>('Notification', notificationSchema);

/**
 * Outgoing WhatsApp Business messages. A message is "accepted" when Meta's API takes it;
 * it becomes "delivered" or "read" only when Meta's status webhook says so.
 */
export interface IMessageLog {
  channel: 'whatsapp';
  to: string;
  template: string;
  params: string[];
  status: 'queued' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
  providerMessageId?: string | null;
  error?: string | null;
  related?: { kind: string; id: Types.ObjectId } | null;
  createdAt: Date;
  updatedAt: Date;
}
const messageSchema = new Schema<IMessageLog>(
  {
    channel: { type: String, enum: ['whatsapp'], required: true },
    to: { type: String, required: true },
    template: { type: String, required: true },
    params: [String],
    status: { type: String, enum: ['queued', 'accepted', 'sent', 'delivered', 'read', 'failed'], default: 'queued' },
    providerMessageId: { type: String, default: null },
    error: { type: String, default: null },
    related: { kind: String, id: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
messageSchema.index({ providerMessageId: 1 }, { unique: true, partialFilterExpression: { providerMessageId: { $type: 'string' } } });
export const MessageLog = model<IMessageLog>('MessageLog', messageSchema);

/** A visitor opened a WhatsApp link. This records intent only, never delivery. */
export interface IWhatsAppClick {
  context: string;
  ref?: string | null;
  branch?: Types.ObjectId | null;
  createdAt: Date;
}
const clickSchema = new Schema<IWhatsAppClick>(
  { context: { type: String, required: true }, ref: { type: String, default: null }, branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null } },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
clickSchema.index({ branch: 1, createdAt: -1 });
clickSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 86_400 });
export const WhatsAppClick = model<IWhatsAppClick>('WhatsAppClick', clickSchema);
