/** Phase 4 response shapes. Money in kobo. */
import type { BranchRef } from './dto';
import type { DeliveryStatus, FulfilmentMethod, PaymentMethod, PaymentStatus, ReservationStatus } from './enums';

export interface ReservationDto {
  id: string;
  reference: string;
  status: ReservationStatus;
  channel: 'online' | 'in_store' | 'phone' | 'whatsapp';
  branch: BranchRef & { phone: string; whatsapp: string; address: string };
  customer: { id: string; fullName: string; phone: string; email: string | null };
  items: { product: { id: string; name: string; slug: string; sku: string; image: string | null }; variant: { id: string; label: string } | null; sku: string; quantity: number; unitPrice: number }[];
  total: number;
  note: string | null;
  rejectionReason: string | null;
  expiresAt: string | null;
  convertedOrder: { id: string; reference: string } | null;
  history: { status: ReservationStatus; at: string; note: string | null }[];
  /** Actions the caller may take now. */
  allowedActions: ('confirm' | 'reject' | 'cancel' | 'convert')[];
  createdAt: string;
}

export interface ReservationTrackingDto {
  reference: string;
  status: ReservationStatus;
  branch: { name: string; phone: string; whatsapp: string; address: string };
  itemCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface PaymentDto {
  id: string;
  reference: string;
  order: { id: string; reference: string };
  branch: BranchRef;
  customer: { id: string; fullName: string };
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  providerReference: string | null;
  receiptNumber: string | null;
  refunds: { amount: number; reason: string; status: 'pending' | 'processed' | 'failed'; at: string; by: string | null }[];
  refundedAmount: number;
  recordedBy: { id: string; fullName: string } | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface OrderPaymentSummary {
  id: string;
  reference: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  receiptNumber: string | null;
  refundedAmount: number;
  verifiedAt: string | null;
}

export interface DeliveryDto {
  id: string;
  order: { id: string; reference: string; status: string; total: number; outstanding: number };
  branch: BranchRef;
  customer: { fullName: string; phone: string };
  address: { line1: string; area: string | null; city: string; state: string; landmark: string | null };
  zone: string | null;
  fee: number;
  status: DeliveryStatus;
  assignedTo: { userId: string | null; name: string; phone: string } | null;
  history: { status: DeliveryStatus; at: string; by: string | null; note: string | null }[];
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface PaymentConfigDto {
  paystackEnabled: boolean;
  bankTransfer: { bankName: string; accountName: string; accountNumber: string } | null;
}

export interface ReceiptDto {
  receiptNumber: string;
  issuedAt: string;
  company: { name: string; address: string | null; phone: string; email: string; footer: string | null; vat: { show: boolean; ratePercent: number; included: boolean } };
  branch: { name: string; address: string; phone: string };
  order: { reference: string; createdAt: string; fulfilment: FulfilmentMethod };
  customer: { fullName: string; phone: string };
  items: { name: string; sku: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  vatAmount: number | null;
  payments: { method: PaymentMethod; amount: number; reference: string; at: string }[];
  amountPaid: number;
  outstanding: number;
}
