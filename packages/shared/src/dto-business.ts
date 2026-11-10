/**
 * Phase 2 response shapes: catalogue, inventory, customers and enquiries.
 * Money is in kobo. Ids and dates are strings.
 */
import type { BranchRef } from './dto';
import type { CustomerSource } from './enums';
import type { CatalogStatus, ProductStatus } from './schemas/catalog';
import type { EnquiryChannel, EnquiryStatus, SegmentFilter } from './schemas/crm';
import type { AdjustmentStatus, MovementType, TransferStatus } from './schemas/inventory';

export interface ImageDto {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  parent: string | null;
  /** Ancestor ids, root first. */
  ancestors: string[];
  description: string | null;
  image: ImageDto | null;
  sortOrder: number;
  status: CatalogStatus;
  productCount?: number;
}

export interface BrandDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  logo: ImageDto | null;
  status: CatalogStatus;
  productCount?: number;
}

export interface VariantDto {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  price: number | null;
  discountPrice: number | null;
  status: CatalogStatus;
  /** "Large / Black" */
  label: string;
}

export interface ProductRef {
  id: string;
  name: string;
  sku: string;
  slug: string;
  image: string | null;
}

/** Staff view of a product. */
export interface ProductDto {
  id: string;
  name: string;
  slug: string;
  sku: string;
  productCode: string | null;
  description: string;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string; slug: string } | null;
  images: ImageDto[];
  price: number;
  discountPrice: number | null;
  /** Only present for users allowed to see cost (inventory:read-cost). */
  costPrice?: number | null;
  specifications: { label: string; value: string }[];
  hasVariants: boolean;
  variants: VariantDto[];
  tags: string[];
  isFeatured: boolean;
  status: ProductStatus;
  relatedProducts: ProductRef[];
  /** Units across the caller's branches. */
  stock?: { onHand: number; reserved: number; available: number };
  createdAt: string;
  updatedAt: string;
}

export type StockLevel = 'in_stock' | 'low' | 'out';

/** Storefront view: no cost price, no exact quantities. */
export interface PublicProductDto {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string; slug: string } | null;
  images: ImageDto[];
  price: number;
  discountPrice: number | null;
  specifications: { label: string; value: string }[];
  hasVariants: boolean;
  variants: VariantDto[];
  tags: string[];
  isFeatured: boolean;
}

export interface BranchAvailabilityDto {
  branch: BranchRef & { city: string; state: string; whatsapp: string; phone: string };
  /** Per variant when the product has variants; key "" otherwise. */
  levels: Record<string, StockLevel>;
  /** Best level across variants. */
  level: StockLevel;
}

export interface InventoryDto {
  id: string;
  branch: BranchRef;
  product: ProductRef;
  variant: { id: string; label: string; sku: string } | null;
  sku: string;
  quantity: number;
  reserved: number;
  available: number;
  reorderLevel: number | null;
  /** reorderLevel or the company default. */
  effectiveReorderLevel: number;
  level: StockLevel;
  isAvailable: boolean;
  updatedAt: string;
}

export interface MovementDto {
  id: string;
  branch: BranchRef;
  product: ProductRef;
  variant: { id: string; label: string } | null;
  sku: string;
  type: MovementType;
  quantityDelta: number;
  reservedDelta: number;
  balanceAfter: number;
  reference: { kind: string; id: string; label: string | null } | null;
  reason: string | null;
  performedBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface StockLineDto {
  product: ProductRef;
  variant: { id: string; label: string } | null;
  sku: string;
}

export interface AdjustmentDto {
  id: string;
  reference: string;
  branch: BranchRef;
  items: (StockLineDto & { delta: number })[];
  reason: string;
  status: AdjustmentStatus;
  requestedBy: { id: string; fullName: string } | null;
  reviewedBy: { id: string; fullName: string } | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface TransferDto {
  id: string;
  reference: string;
  fromBranch: BranchRef;
  toBranch: BranchRef;
  items: (StockLineDto & { quantity: number })[];
  status: TransferStatus;
  note: string | null;
  history: { status: TransferStatus; by: { id: string; fullName: string } | null; at: string; note: string | null }[];
  requestedBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Actions the caller may take now. */
  allowedActions: ('approve' | 'reject' | 'dispatch' | 'receive' | 'cancel')[];
}

export interface AddressDto {
  id: string;
  label: string | null;
  line1: string;
  area: string | null;
  city: string;
  state: string;
  landmark: string | null;
  isDefault: boolean;
}

export interface CustomerDto {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  hasAccount: boolean;
  preferredBranch: BranchRef | null;
  branchesServed: BranchRef[];
  source: CustomerSource;
  tags: string[];
  notes: string | null;
  addresses: AddressDto[];
  stats: { orderCount: number; totalSpent: number; lastOrderAt: string | null; reservationCount: number };
  registeredBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** What staff see when looking up a phone number that belongs to another branch's customer. */
export interface CustomerLookupDto {
  id: string;
  fullName: string;
  phone: string;
  /** Already visible to the caller (served by one of their branches). */
  inScope: boolean;
}

export interface InteractionDto {
  id: string;
  branch: BranchRef | null;
  channel: string;
  direction: 'inbound' | 'outbound';
  summary: string;
  relatedTo: { kind: string; id: string; label: string | null } | null;
  recordedBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface SegmentDto {
  id: string;
  name: string;
  description: string | null;
  filter: SegmentFilter;
  customerCount?: number;
  createdBy: { id: string; fullName: string } | null;
  updatedAt: string;
}

export interface EnquiryDto {
  id: string;
  reference: string;
  branch: BranchRef;
  channel: EnquiryChannel;
  status: EnquiryStatus;
  contact: { name: string; phone: string; email: string | null };
  customer: { id: string; fullName: string } | null;
  product: ProductRef | null;
  subject: string;
  message: string;
  assignedTo: { id: string; fullName: string } | null;
  notes: { text: string; by: { id: string; fullName: string } | null; at: string }[];
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaUploadDto {
  url: string;
  publicId: string;
  width: number | null;
  height: number | null;
}
