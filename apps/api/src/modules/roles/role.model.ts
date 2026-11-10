import { type Permission, ALL_PERMISSIONS, ROLE_KEYS, ROLE_SCOPES, type RoleKey, type RoleScope } from '@mb/shared';
import { type HydratedDocument, Schema, model } from 'mongoose';

export interface IRole {
  key: RoleKey;
  name: string;
  description: string;
  scope: RoleScope;
  permissions: Permission[];
  isSystem: boolean;
  /** True once an admin edits the permissions; system sync then leaves them alone. */
  customized: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    key: { type: String, enum: ROLE_KEYS, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 300 },
    scope: { type: String, enum: ROLE_SCOPES, required: true },
    permissions: [{ type: String, enum: ALL_PERMISSIONS }],
    isSystem: { type: Boolean, default: true },
    customized: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Role = model<IRole>('Role', roleSchema);
export type RoleDoc = HydratedDocument<IRole>;
