/** Central enumerations shared by the API and the web app. */

export const ROLE_KEYS = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'SALES_STAFF', 'CUSTOMER'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Higher rank can manage lower rank. Used to stop privilege escalation in user management. */
export const ROLE_RANK: Record<RoleKey, number> = {
  SUPER_ADMIN: 100,
  BRANCH_ADMIN: 50,
  SALES_STAFF: 10,
  CUSTOMER: 0,
};

export const STAFF_ROLE_KEYS = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'SALES_STAFF'] as const;
export type StaffRoleKey = (typeof STAFF_ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  SUPER_ADMIN: 'Super Admin',
  BRANCH_ADMIN: 'Branch Admin',
  SALES_STAFF: 'Sales Staff',
  CUSTOMER: 'Customer',
};

/** Roles that must be assigned to at least one branch. */
export const BRANCH_BOUND_ROLES: readonly RoleKey[] = ['BRANCH_ADMIN', 'SALES_STAFF'];

/**
 * How far a role's permissions reach.
 * - company: every branch
 * - branch: only assigned branches (plus explicit grants)
 * - self: only records belonging to the user (customers)
 */
export const ROLE_SCOPES = ['company', 'branch', 'self'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const BRANCH_STATUSES = ['active', 'inactive'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara',
] as const;
export type NigerianState = (typeof NIGERIAN_STATES)[number];

export const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

export const CUSTOMER_SOURCES = ['online', 'walk_in', 'whatsapp', 'phone', 'guest_checkout'] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

// Transaction enums are used from Phase 2 onwards; they are defined centrally now so contracts stay stable.

export const ORDER_STATUSES = [
  'pending', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery',
  'completed', 'cancelled', 'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const RESERVATION_STATUSES = [
  'pending', 'confirmed', 'rejected', 'expired', 'converted', 'cancelled',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const PAYMENT_METHODS = [
  'paystack', 'bank_transfer', 'cash', 'pos', 'pay_on_pickup', 'pay_on_delivery',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'success', 'failed', 'abandoned', 'reversed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILMENT_METHODS = ['pickup', 'delivery'] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

export const DELIVERY_STATUSES = ['pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const ORDER_CHANNELS = ['online', 'in_store', 'whatsapp', 'phone'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** Order workflow. Cancellation is allowed from any open state (see ORDER_CANCELLABLE). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed'],
  confirmed: ['processing'],
  processing: ['ready_for_pickup', 'out_for_delivery'],
  ready_for_pickup: ['completed'],
  out_for_delivery: ['completed'],
  completed: [],
  cancelled: [],
  refunded: [],
};
export const ORDER_CANCELLABLE: OrderStatus[] = ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery'];
