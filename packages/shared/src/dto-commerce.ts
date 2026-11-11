/** Phase 3 response shapes: promotions, delivery zones, cart, checkout and orders. Money in kobo. */
import type { BranchRef } from './dto';
import type { ImageDto, StockLevel } from './dto-business';
import type { FulfilmentMethod, OrderStatus, PaymentMethod } from './enums';
import type { PromotionType } from './schemas/commerce';
import type { DeliveryStatus } from './enums';
import type { OrderPaymentSummary } from './dto-transactions';

export interface PromotionDto {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  type: PromotionType;
  value: number;
  products: string[];
  categories: string[];
  brands: string[];
  branches: string[];
  minOrderAmount: number | null;
  maxDiscount: number | null;
  startsAt: string;
  endsAt: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  status: 'active' | 'inactive';
  /** active and within its dates */
  live: boolean;
}

/** What the storefront may show about a running promotion. */
export interface PublicPromotionDto {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  type: PromotionType;
  value: number;
  minOrderAmount: number | null;
  endsAt: string;
}

export interface DeliveryZoneDto {
  id: string;
  branch: BranchRef;
  name: string;
  areas: string[];
  fee: number;
  freeAbove: number | null;
  estimatedDays: number;
  status: 'active' | 'inactive';
}

export interface CartLineDto {
  key: string;
  product: { id: string; name: string; slug: string; sku: string; image: ImageDto | null; status: string };
  variant: { id: string; label: string; sku: string } | null;
  quantity: number;
  unitPrice: number;
  compareAtPrice: number | null;
  lineTotal: number;
  /** At the cart's branch; null when no branch is chosen. */
  level: StockLevel | null;
  /** The quantity cannot be supplied from the chosen branch right now. */
  problem: string | null;
}

export interface CartDto {
  branch: (BranchRef & { pickup: boolean; delivery: boolean }) | null;
  lines: CartLineDto[];
  itemCount: number;
  subtotal: number;
}

export interface QuoteDto {
  lines: CartLineDto[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  promotion: { id: string; name: string; code: string | null } | null;
  /** Why a code was not applied. */
  promoMessage: string | null;
  deliveryZone: { id: string; name: string; estimatedDays: number } | null;
  /** Blocking issues (out of stock, inactive product, missing branch). Empty means the order can be placed. */
  problems: string[];
}

export interface OrderItemDto {
  product: { id: string; name: string; slug: string; sku: string; image: string | null };
  variant: { id: string; label: string } | null;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderDto {
  id: string;
  reference: string;
  channel: 'online' | 'in_store' | 'whatsapp' | 'phone';
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'refunded' | 'partially_refunded';
  branch: BranchRef & { phone: string; whatsapp: string; address: string };
  customer: { id: string; fullName: string; phone: string; email: string | null };
  items: OrderItemDto[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  amountPaid: number;
  /** total minus net payments received. */
  outstanding: number;
  payments: OrderPaymentSummary[];
  delivery: { id: string; status: DeliveryStatus; assignedTo: { name: string; phone: string } | null } | null;
  /** Next workflow steps the caller may take (staff views). */
  allowedTransitions: OrderStatus[];
  createdBy: string | null;
  promotion: { name: string; code: string | null } | null;
  fulfilment: {
    method: FulfilmentMethod;
    zone: { id: string; name: string } | null;
    address: { line1: string; area: string | null; city: string; state: string; landmark: string | null } | null;
  };
  note: string | null;
  statusHistory: { from: OrderStatus | null; to: OrderStatus; at: string; by: string | null; note: string | null }[];
  canCancel: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Public tracking view: no customer contact details or prices beyond the total. */
export interface OrderTrackingDto {
  reference: string;
  status: OrderStatus;
  fulfilment: FulfilmentMethod;
  branch: { name: string; phone: string; whatsapp: string; address: string };
  itemCount: number;
  total: number;
  history: { status: OrderStatus; at: string }[];
  createdAt: string;
}
