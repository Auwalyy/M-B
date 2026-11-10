import { CATALOG_STATUSES, type CatalogStatus, PRODUCT_STATUSES, type ProductStatus } from '@mb/shared';
import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

export interface IImage {
  _id: Types.ObjectId;
  url: string;
  publicId: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
}

export const imageSchema = new Schema<IImage>({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  alt: { type: String, maxlength: 160 },
  width: Number,
  height: Number,
});

// ------------------------------------------------------------------ Category

export interface ICategory {
  name: string;
  slug: string;
  parent: Types.ObjectId | null;
  /** Root-first ancestor ids, for subtree queries without recursion. */
  ancestors: Types.ObjectId[];
  description?: string;
  image?: IImage | null;
  sortOrder: number;
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    ancestors: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    description: { type: String, maxlength: 500 },
    image: { type: imageSchema, default: null },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: CATALOG_STATUSES, default: 'active' },
  },
  { timestamps: true },
);
categorySchema.index({ parent: 1, sortOrder: 1, name: 1 });
categorySchema.index({ ancestors: 1 });

export const Category = model<ICategory>('Category', categorySchema);
export type CategoryDoc = HydratedDocument<ICategory>;

// ------------------------------------------------------------------ Brand

export interface IBrand {
  name: string;
  slug: string;
  description?: string;
  website?: string;
  logo?: IImage | null;
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

const brandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true },
    description: { type: String, maxlength: 500 },
    website: { type: String, maxlength: 200 },
    logo: { type: imageSchema, default: null },
    status: { type: String, enum: CATALOG_STATUSES, default: 'active' },
  },
  { timestamps: true },
);
brandSchema.index({ status: 1, name: 1 });

export const Brand = model<IBrand>('Brand', brandSchema);
export type BrandDoc = HydratedDocument<IBrand>;

// ------------------------------------------------------------------ Product

export interface IVariant {
  _id: Types.ObjectId;
  sku: string;
  size?: string;
  color?: string;
  price?: number | null;
  discountPrice?: number | null;
  status: CatalogStatus;
}

export interface IProduct {
  name: string;
  slug: string;
  sku: string;
  productCode?: string;
  description: string;
  category: Types.ObjectId;
  /** Category plus its ancestors, so filtering by a parent category includes subcategories. */
  categoryPath: Types.ObjectId[];
  brand?: Types.ObjectId | null;
  images: Types.DocumentArray<IImage>;
  price: number;
  discountPrice?: number | null;
  /** discountPrice ?? price; used for price filters and sorting. */
  effectivePrice: number;
  costPrice?: number | null;
  specifications: { label: string; value: string }[];
  hasVariants: boolean;
  variants: Types.DocumentArray<IVariant>;
  tags: string[];
  isFeatured: boolean;
  status: ProductStatus;
  relatedProducts: Types.ObjectId[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<IVariant>({
  sku: { type: String, required: true, uppercase: true, trim: true },
  size: { type: String, maxlength: 40 },
  color: { type: String, maxlength: 40 },
  price: { type: Number, default: null },
  discountPrice: { type: Number, default: null },
  status: { type: String, enum: CATALOG_STATUSES, default: 'active' },
});

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    productCode: { type: String, trim: true, maxlength: 60 },
    description: { type: String, default: '', maxlength: 10_000 },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    categoryPath: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    brand: { type: Schema.Types.ObjectId, ref: 'Brand', default: null },
    images: [imageSchema],
    price: { type: Number, required: true, min: 0 },
    discountPrice: { type: Number, default: null },
    effectivePrice: { type: Number, required: true },
    costPrice: { type: Number, default: null, select: false },
    specifications: [{ _id: false, label: { type: String, required: true }, value: { type: String, required: true } }],
    hasVariants: { type: Boolean, default: false },
    variants: [variantSchema],
    tags: [{ type: String, lowercase: true, trim: true }],
    isFeatured: { type: Boolean, default: false },
    status: { type: String, enum: PRODUCT_STATUSES, default: 'draft' },
    relatedProducts: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true },
);

productSchema.pre('validate', function () {
  this.effectivePrice = this.discountPrice ?? this.price;
});

productSchema.index({ productCode: 1 }, { unique: true, partialFilterExpression: { productCode: { $type: 'string' } } });
// Unique across products (a multikey unique index does not stop duplicates within one product;
// the service checks that case).
productSchema.index({ 'variants.sku': 1 }, { unique: true, partialFilterExpression: { 'variants.sku': { $type: 'string' } } });
productSchema.index({ status: 1, categoryPath: 1, effectivePrice: 1 });
productSchema.index({ status: 1, brand: 1 });
productSchema.index({ status: 1, isFeatured: 1, createdAt: -1 });
productSchema.index(
  { name: 'text', sku: 'text', tags: 'text', description: 'text', 'variants.sku': 'text' },
  { weights: { name: 10, sku: 8, 'variants.sku': 8, tags: 5, description: 1 }, name: 'product_text' },
);

export const Product = model<IProduct>('Product', productSchema);
export type ProductDoc = HydratedDocument<IProduct>;

export function variantLabel(v: Pick<IVariant, 'size' | 'color'>): string {
  return [v.size, v.color].filter(Boolean).join(' / ') || 'Default';
}
