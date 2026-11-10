import { Schema, type Types, model } from 'mongoose';

/** Append-only record of security-relevant and business-critical actions. */
export interface IAuditLog {
  actor?: Types.ObjectId;
  actorRole?: string;
  action: string;
  branch?: Types.ObjectId;
  entity?: { kind: string; id?: Types.ObjectId; label?: string };
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  createdAt: Date;
}

const auditSchema = new Schema<IAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: String,
    action: { type: String, required: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    entity: {
      kind: String,
      id: Schema.Types.ObjectId,
      label: String,
    },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    meta: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ actor: 1, createdAt: -1 });
auditSchema.index({ branch: 1, createdAt: -1 });
auditSchema.index({ 'entity.kind': 1, 'entity.id': 1, createdAt: -1 });

// Block updates and deletes through Mongoose. Audit entries are never edited.
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditSchema.pre(op, function () {
    throw new Error('Audit logs are append-only');
  });
}

export const AuditLog = model<IAuditLog>('AuditLog', auditSchema);
