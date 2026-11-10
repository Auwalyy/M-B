import { z } from 'zod';
import { objectId, optionalText, paginationQuery, queryBoolean, text } from './common';

export const PRODUCT_STATUSES = ['draft', 'active', 'inactive'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const CATALOG_STATUSES = ['active', 'inactive'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/** Upper-case letters, digits and dashes, e.g. SAM-TV-001. */
export const sku = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, 'Use letters, digits and dashes, e.g. SAM-TV-001');

/** Integer kobo (₦1 = 100). */
export const kobo = z.number().int('Amount must be in kobo (whole number)').min(0).max(1_000_000_000_00);

/*
 * Zod 4 applies .default() even inside .partial(), so update schemas are built from field sets
 * WITHOUT defaults. Otherwise a partial update would silently reset omitted fields.
 */
const categoryFields = {
  name: text(80),
  parent: objectId.nullable().optional(),
  description: optionalText(500),
  sortOrder: z.number().int().min(0).max(9999),
  status: z.enum(CATALOG_STATUSES),
};
export const categorySchema = z.object({
  ...categoryFields,
  sortOrder: categoryFields.sortOrder.default(0),
  status: categoryFields.status.default('active'),
});
export type CategoryInput = z.input<typeof categorySchema>;
export const updateCategorySchema = z.object(categoryFields).partial();

const brandFields = {
  name: text(80),
  description: optionalText(500),
  website: optionalText(200),
  status: z.enum(CATALOG_STATUSES),
};
export const brandSchema = z.object({ ...brandFields, status: brandFields.status.default('active') });
export type BrandInput = z.input<typeof brandSchema>;
export const updateBrandSchema = z.object(brandFields).partial();

export const variantSchema = z
  .object({
    /** Present when editing an existing variant (keeps its inventory). */
    id: objectId.optional(),
    sku,
    size: optionalText(40),
    color: optionalText(40),
    /** Overrides the product price when set. */
    price: kobo.nullable().optional(),
    discountPrice: kobo.nullable().optional(),
    status: z.enum(CATALOG_STATUSES).default('active'),
  })
  .refine((v) => v.size || v.color, { message: 'Give each variant a size or a colour', path: ['size'] })
  .refine((v) => v.discountPrice == null || v.price == null || v.discountPrice < v.price, {
    message: 'Discounted price must be lower than the price',
    path: ['discountPrice'],
  });
export type VariantInput = z.input<typeof variantSchema>;

const productFields = {
  name: text(160),
  sku,
  productCode: optionalText(60),
  description: z.string().trim().max(10_000),
  category: objectId,
  brand: objectId.nullable().optional(),
  price: kobo.min(1, 'Enter a price'),
  discountPrice: kobo.nullable().optional(),
  costPrice: kobo.nullable().optional(),
  specifications: z.array(z.object({ label: text(60), value: text(300) })).max(50),
  hasVariants: z.boolean(),
  variants: z.array(variantSchema).max(100),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20),
  isFeatured: z.boolean(),
  status: z.enum(PRODUCT_STATUSES),
  relatedProducts: z.array(objectId).max(12),
};

type ProductShape = { price?: number; discountPrice?: number | null; hasVariants?: boolean; variants?: { sku: string }[]; sku?: string };

/** Rules that span fields. The API re-checks them on the merged document after a partial update. */
export function productRuleIssues(p: ProductShape): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (p.discountPrice != null && p.price != null && p.discountPrice >= p.price) {
    issues.push({ path: 'discountPrice', message: 'Discounted price must be lower than the price' });
  }
  if (p.hasVariants && (p.variants?.length ?? 0) === 0) {
    issues.push({ path: 'variants', message: 'Add at least one variant, or turn off variants' });
  }
  const skus = (p.variants ?? []).map((v) => v.sku);
  if (new Set(skus).size !== skus.length) issues.push({ path: 'variants', message: 'Variant SKUs must be unique' });
  if (p.sku && skus.includes(p.sku)) issues.push({ path: 'variants', message: 'A variant SKU cannot equal the product SKU' });
  return issues;
}

export const productSchema = z
  .object({
    ...productFields,
    description: productFields.description.default(''),
    specifications: productFields.specifications.default([]),
    hasVariants: productFields.hasVariants.default(false),
    variants: productFields.variants.default([]),
    tags: productFields.tags.default([]),
    isFeatured: productFields.isFeatured.default(false),
    status: productFields.status.default('draft'),
    relatedProducts: productFields.relatedProducts.default([]),
  })
  .superRefine((p, ctx) => {
  for (const i of productRuleIssues(p)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
});
export type ProductInput = z.input<typeof productSchema>;

export const updateProductSchema = z.object(productFields).partial();
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export const PRODUCT_SORTS = ['newest', 'name', 'price_asc', 'price_desc'] as const;

export const listProductsQuery = paginationQuery.extend({
  category: objectId.optional(),
  brand: objectId.optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  featured: queryBoolean.optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  /** Only products with stock in this branch (storefront) / stock figures for this branch (staff). */
  branch: objectId.optional(),
  inStock: queryBoolean.optional(),
  sort: z.enum(PRODUCT_SORTS).default('newest'),
});

export const productImagesUpdateSchema = z.object({
  images: z.array(z.object({ id: objectId, alt: optionalText(160) })).max(12),
});

export const listCategoriesQuery = z.object({
  status: z.enum(CATALOG_STATUSES).optional(),
});
