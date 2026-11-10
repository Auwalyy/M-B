/**
 * Response shapes returned by the API. Ids and dates are serialised as strings.
 */
import type { BranchStatus, RoleKey, RoleScope, UserStatus } from './enums';
import type { Permission } from './permissions';
import type { PageMeta } from './schemas/common';

export interface Envelope<T> {
  data: T;
}
export interface PageEnvelope<T> {
  data: T[];
  meta: PageMeta;
}

export interface BranchRef {
  id: string;
  name: string;
  code: string;
}

export interface BranchAccessGrantDto {
  id: string;
  branch: BranchRef;
  permissions: Permission[];
  expiresAt: string;
  reason: string;
  grantedBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface AuthUserDto {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: RoleKey;
  roleName: string;
  scope: RoleScope;
  /** Effective permissions: role permissions plus any active branch-access grants. */
  permissions: Permission[];
  branches: BranchRef[];
  grants: BranchAccessGrantDto[];
  customerId: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface AuthResponseDto {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthUserDto;
}

export interface SessionDto {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface OpeningHoursDto {
  day: number;
  open: string;
  close: string;
  closed: boolean;
}

export interface PublicBranchDto {
  id: string;
  name: string;
  code: string;
  address: string;
  area: string | null;
  landmark: string | null;
  city: string;
  state: string;
  phone: string;
  whatsapp: string;
  email: string | null;
  coordinates: { lat: number; lng: number } | null;
  openingHours: OpeningHoursDto[];
  services: { reservations: boolean; pickup: boolean; delivery: boolean };
}

export interface BranchDto extends PublicBranchDto {
  status: BranchStatus;
  admins: { id: string; fullName: string }[];
  settings: {
    reservationsEnabled: boolean;
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    reservationHoldHours: number | null;
  };
  staffCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StaffDto {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: RoleKey;
  roleName: string;
  status: UserStatus;
  branches: BranchRef[];
  grants: BranchAccessGrantDto[];
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RoleDto {
  id: string;
  key: RoleKey;
  name: string;
  description: string;
  scope: RoleScope;
  permissions: Permission[];
  isSystem: boolean;
  customized: boolean;
  userCount?: number;
}

export interface PublicSettingsDto {
  companyName: string;
  tagline: string | null;
  supportEmail: string;
  supportPhone: string;
  whatsapp: string;
  address: string | null;
  logoUrl: string | null;
  guestCheckoutEnabled: boolean;
  pricesIncludeVat: boolean;
}

export interface SettingsDto extends PublicSettingsDto {
  lowStockDefault: number;
  adjustmentApprovalThreshold: number;
  reservation: { pendingExpiryHours: number; confirmedHoldHours: number; maxQuantityPerItem: number };
  showVatOnReceipts: boolean;
  vatRatePercent: number;
  receiptFooter: string | null;
  updatedAt: string;
}

export interface AuditLogDto {
  id: string;
  actor: { id: string; fullName: string } | null;
  actorRole: string | null;
  action: string;
  branch: BranchRef | null;
  entity: { kind: string; id: string | null; label: string | null } | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}
