import { type Permission, ALL_PERMISSIONS, ROLE_KEYS, type RoleKey, USER_STATUSES, type UserStatus } from '@mb/shared';
import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

export interface IBranchAccessGrant {
  _id: Types.ObjectId;
  branch: Types.ObjectId;
  permissions: Permission[];
  expiresAt: Date;
  reason: string;
  grantedBy: Types.ObjectId;
  createdAt: Date;
}

export interface IUser {
  fullName: string;
  email?: string;
  phone?: string;
  passwordHash: string;
  role: Types.ObjectId;
  /** Denormalised role key so queries and checks do not need a join. */
  roleKey: RoleKey;
  branches: Types.ObjectId[];
  branchAccessGrants: Types.DocumentArray<IBranchAccessGrant>;
  customer?: Types.ObjectId;
  status: UserStatus;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  avatarUrl?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const grantSchema = new Schema<IBranchAccessGrant>(
  {
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    permissions: [{ type: String, enum: ALL_PERMISSIONS, required: true }],
    expiresAt: { type: Date, required: true },
    reason: { type: String, required: true, maxlength: 300 },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const userSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    roleKey: { type: String, enum: ROLE_KEYS, required: true },
    branches: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    branchAccessGrants: [grantSchema],
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    status: { type: String, enum: USER_STATUSES, default: 'active' },
    mustChangePassword: { type: Boolean, default: false },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
    passwordChangedAt: Date,
    avatarUrl: { type: String, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Uniqueness only applies when the field is present (customers may sign up without an email).
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
userSchema.index({ roleKey: 1, status: 1 });
userSchema.index({ branches: 1, roleKey: 1 });
userSchema.index({ customer: 1 }, { unique: true, partialFilterExpression: { customer: { $type: 'objectId' } } });
userSchema.index({ fullName: 'text', email: 'text', phone: 'text' });

export const User = model<IUser>('User', userSchema);
export type UserDoc = HydratedDocument<IUser>;
