import type { BranchRef } from './dto';
import type { InventoryDto } from './dto-business';
import type { OrderChannel, OrderStatus, PaymentMethod } from './enums';
import type { ReportGrouping } from './schemas/analytics';

/**
 * Analytics and report contracts. Money is in kobo. Metric definitions
 * (gross sales, collected revenue, outstanding balance, inventory value, units sold)
 * are in docs/FOUNDATION.md §1.5; every figure here follows them.
 */

/** Inclusive Lagos calendar days, YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

/** A figure for the chosen range and the same-length range just before it. */
export interface Kpi {
  value: number;
  previous: number;
}

export interface ReportAccess {
  /** Collected revenue, refunds, outstanding balances and payment reports. */
  financial: boolean;
  /** Inventory value at cost. */
  cost: boolean;
}

export interface AnalyticsOverviewDto {
  range: DateRange;
  previousRange: DateRange;
  /** Set when the figures are for one branch. */
  branch: BranchRef | null;
  /** Number of branches the figures cover. */
  branchCount: number;
  access: ReportAccess;
  sales: { grossSales: Kpi; orders: Kpi; averageOrderValue: Kpi; unitsSold: Kpi };
  /** Null without financial access. */
  financial: { collectedRevenue: Kpi; refunds: Kpi; outstandingBalance: number; ordersWithBalance: number } | null;
  inventory: {
    /** Null without cost access. */
    value: number | null;
    /** Stock lines whose product has no cost price, so they are left out of the value. */
    linesWithoutCost: number;
    units: number;
    lowStock: number;
    outOfStock: number;
  };
  operations: {
    pendingOrders: number;
    ordersInProgress: number;
    openReservations: number;
    paymentsAwaitingReview: number;
    activeDeliveries: number;
    openEnquiries: number;
  };
  customers: { total: number; new: Kpi };
  activeProducts: number;
}

export interface BranchPerformanceDto {
  branch: BranchRef & { city: string; status: string };
  grossSales: number;
  orders: number;
  averageOrderValue: number;
  unitsSold: number;
  /** This branch's part of gross sales across the branches shown (0 to 1). */
  shareOfSales: number;
  collectedRevenue: number | null;
  outstandingBalance: number | null;
  inventoryValue: number | null;
  lowStock: number;
}

export interface BranchPerformanceReportDto {
  range: DateRange;
  access: ReportAccess;
  branches: BranchPerformanceDto[];
}

export interface SalesPointDto {
  /** First day of the bucket, YYYY-MM-DD. */
  period: string;
  grossSales: number;
  orders: number;
  /** Null without financial access. */
  collectedRevenue: number | null;
}

export interface SalesSeriesDto {
  range: DateRange;
  groupBy: ReportGrouping;
  access: ReportAccess;
  points: SalesPointDto[];
  totals: { grossSales: number; orders: number; collectedRevenue: number | null };
}

export interface TopProductDto {
  product: { id: string; name: string; slug: string; sku: string };
  unitsSold: number;
  /** Line totals before order-level discounts. */
  revenue: number;
  orders: number;
}

export interface TopProductsDto {
  range: DateRange;
  by: 'revenue' | 'units';
  products: TopProductDto[];
}

export interface RecentOrderDto {
  id: string;
  reference: string;
  branch: BranchRef;
  customerName: string;
  channel: OrderChannel;
  total: number;
  status: OrderStatus;
  paymentStatus: string;
  createdAt: string;
}

export interface RecentPaymentDto {
  id: string;
  reference: string;
  receiptNumber: string | null;
  orderId: string;
  orderReference: string;
  branch: BranchRef;
  method: PaymentMethod;
  amount: number;
  verifiedAt: string;
}

export interface RecentTransactionsDto {
  orders: RecentOrderDto[];
  /** Null without financial access. */
  payments: RecentPaymentDto[] | null;
}

export type LowStockDto = InventoryDto[];

// ------------------------------------------------------------------ Reports

export interface ReportPage<Row, Summary> {
  range: DateRange | null;
  summary: Summary;
  rows: Row[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface SalesReportRow {
  id: string;
  reference: string;
  confirmedAt: string;
  branch: BranchRef;
  channel: OrderChannel;
  customerName: string;
  customerPhone: string;
  units: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  amountPaid: number;
  outstanding: number;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod: PaymentMethod;
  fulfilment: 'pickup' | 'delivery';
}

export interface SalesReportSummary {
  orders: number;
  grossSales: number;
  discounts: number;
  deliveryFees: number;
  units: number;
  /** Paid against these orders so far (net of refunds). */
  paidOnOrders: number;
  outstanding: number;
  byChannel: { channel: OrderChannel; orders: number; grossSales: number }[];
}

export interface InventoryReportRow {
  id: string;
  branch: BranchRef;
  sku: string;
  product: { id: string; name: string };
  variantLabel: string | null;
  quantity: number;
  reserved: number;
  available: number;
  reorderLevel: number;
  stock: 'ok' | 'low' | 'out';
  unitPrice: number;
  retailValue: number;
  /** Null without cost access. */
  costPrice: number | null;
  costValue: number | null;
}

export interface InventoryReportSummary {
  lines: number;
  units: number;
  reserved: number;
  retailValue: number;
  costValue: number | null;
  linesWithoutCost: number;
  low: number;
  out: number;
}

export interface CustomerReportRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  orders: number;
  spent: number;
  averageOrderValue: number;
  firstOrderAt: string;
  lastOrderAt: string;
  branches: string[];
  /** The customer record was created in the range. */
  isNew: boolean;
}

export interface CustomerReportSummary {
  customers: number;
  orders: number;
  spent: number;
  newCustomers: number;
  repeatCustomers: number;
}

export interface PaymentReportRow {
  id: string;
  reference: string;
  receiptNumber: string | null;
  verifiedAt: string;
  branch: BranchRef;
  orderReference: string;
  customerName: string;
  method: PaymentMethod;
  amount: number;
  /** Processed refunds on this payment, whenever they happened. */
  refunded: number;
  verifiedBy: string | null;
}

export interface PaymentReportSummary {
  payments: number;
  received: number;
  /** Processed refunds dated in the range. */
  refunds: number;
  /** received − refunds: the collected-revenue metric. */
  collectedRevenue: number;
  byMethod: { method: PaymentMethod; payments: number; amount: number }[];
}
