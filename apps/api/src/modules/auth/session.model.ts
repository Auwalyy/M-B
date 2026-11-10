import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

/**
 * A sign-in session. It holds the hash of the current refresh token and the hash of the
 * previous one, so reuse of an already-rotated token can be detected.
 */
export interface ISession {
  user: Types.ObjectId;
  tokenHash: string;
  previousTokenHash?: string;
  rotatedAt?: Date;
  userAgent?: string;
  ip?: string;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    previousTokenHash: { type: String },
    rotatedAt: Date,
    userAgent: { type: String, maxlength: 400 },
    ip: { type: String, maxlength: 64 },
    lastUsedAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: { type: String, maxlength: 60 },
  },
  { timestamps: true },
);

// MongoDB deletes expired sessions automatically.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<ISession>('Session', sessionSchema);
export type SessionDoc = HydratedDocument<ISession>;

export interface IPasswordResetToken {
  user: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

const resetSchema = new Schema<IPasswordResetToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
resetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetToken = model<IPasswordResetToken>('PasswordResetToken', resetSchema);
