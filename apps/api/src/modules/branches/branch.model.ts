import { BRANCH_STATUSES, type BranchStatus, NIGERIAN_STATES } from '@mb/shared';
import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

export interface IOpeningHours {
  day: number;
  open: string;
  close: string;
  closed: boolean;
}

export interface IBranchSettings {
  reservationsEnabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  reservationHoldHours: number | null;
}

export interface IBranch {
  name: string;
  code: string;
  address: string;
  area?: string;
  landmark?: string;
  city: string;
  state: string;
  phone: string;
  whatsapp: string;
  email?: string;
  location?: { type: 'Point'; coordinates: [number, number] };
  openingHours: IOpeningHours[];
  settings: IBranchSettings;
  admins: Types.ObjectId[];
  status: BranchStatus;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Default hours: Monday–Saturday 08:00–18:00, closed on Sunday. */
export const DEFAULT_OPENING_HOURS: IOpeningHours[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  open: '08:00',
  close: '18:00',
  closed: day === 0,
}));

const branchSchema = new Schema<IBranch>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, uppercase: true, trim: true, unique: true, match: /^[A-Z]{3}\d{2}$/ },
    address: { type: String, required: true, maxlength: 300 },
    area: { type: String, maxlength: 120 },
    landmark: { type: String, maxlength: 200 },
    city: { type: String, required: true, maxlength: 80 },
    state: { type: String, required: true, enum: NIGERIAN_STATES },
    phone: { type: String, required: true },
    whatsapp: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined },
    },
    openingHours: {
      type: [
        new Schema<IOpeningHours>(
          {
            day: { type: Number, min: 0, max: 6, required: true },
            open: { type: String, required: true },
            close: { type: String, required: true },
            closed: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: () => DEFAULT_OPENING_HOURS,
    },
    settings: {
      reservationsEnabled: { type: Boolean, default: true },
      pickupEnabled: { type: Boolean, default: true },
      deliveryEnabled: { type: Boolean, default: true },
      reservationHoldHours: { type: Number, default: null },
    },
    admins: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    status: { type: String, enum: BRANCH_STATUSES, default: 'active', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

branchSchema.index({ state: 1, city: 1, status: 1 });
branchSchema.index({ location: '2dsphere' }, { sparse: true });
branchSchema.index({ name: 'text', city: 'text', area: 'text', code: 'text' });

export const Branch = model<IBranch>('Branch', branchSchema);
export type BranchDoc = HydratedDocument<IBranch>;
