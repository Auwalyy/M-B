import {
  type BranchAvailabilityDto,
  type BrandDto,
  type CategoryDto,
  type ImageDto,
  PERMISSIONS,
  type ProductDto,
  type ProductRef,
  type PublicProductDto,
  type StockLevel,
  type VariantDto,
  type brandSchema,
  type categorySchema,
  type listProductsQuery,
  type productImagesUpdateSchema,
  productRuleIssues,
  type productSchema,
  type updateBrandSchema,
  type updateCategorySchema,
  type updateProductSchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { withTransaction } from '../../core/db/transaction';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta, UploadedFile } from '../../core/http/route';
import { removeImagesLater, storeImage } from '../../core/storage/storage';
import { uniqueSlug } from '../../core/text/slug';
import { audit, pick } from '../audit/audit.service';
import { Branch } from '../branches/branch.model';
import { Inventory } from '../inventory/inventory.models';
import { getSettingsDoc } from '../settings/settings.service';
import { Brand, type BrandDoc, Category, type CategoryDoc, type IImage, type IProduct, type IVariant, Product, type ProductDoc, variantLabel } from './catalog.models';

const P = PERMISSIONS;
const MAX_PRODUCT_IMAGES = 12;

// ------------------------------------------------------------------ mappers

export const imageDto = (i: IImage | null | undefined): ImageDto | null =>
  i ? { id: i._id.toString(), url: i.url, alt: i.alt ?? null, width: i.width ?? null, height: i.height ?? null } : null;

export function productRef(p: { _id: Types.ObjectId; name: string; sku: string; slug: string; images?: IImage[] }): ProductRef {
  return { id: p._id.toString(), name: p.name, sku: p.sku, slug: p.slug, image: p.images?.[0]?.url ?? null };
}

const variantDto = (v: IVariant): VariantDto => ({
  id: v._id.toString(),
  sku: v.sku,
  size: v.size ?? null,
  color: v.color ?? null,
  price: v.price ?? null,
  discountPrice: v.discountPrice ?? null,
  status: v.status,
  label: variantLabel(v),
});

function categoryDto(c: CategoryDoc, productCount?: number): CategoryDto {
  return {
    id: c._id.toString(),
    name: c.name,
    slug: c.slug,
    parent: c.parent?.toString() ?? null,
    ancestors: c.ancestors.map(String),
    description: c.description ?? null,
    image: imageDto(c.image),
    sortOrder: c.sortOrder,
    status: c.status,
    productCount,
  };
}

function brandDto(b: BrandDoc, productCount?: number): BrandDto {
  return {
    id: b._id.toString(),
    name: b.name,
    slug: b.slug,
    description: b.description ?? null,
    website: b.website ?? null,
    logo: imageDto(b.logo),
    status: b.status,
    productCount,
  };
}

type Populated = Omit<IProduct, 'category' | 'brand' | 'relatedProducts'> & {
  _id: Types.ObjectId;
  category: { _id: Types.ObjectId; name: string; slug: string } | null;
  brand: { _id: Types.ObjectId; name: string; slug: string } | null;
  relatedProducts: { _id: Types.ObjectId; name: string; sku: string; slug: string; images: IImage[] }[];
};

const ref = (x: { _id: Types.ObjectId; name: string; slug: string } | null) => (x ? { id: x._id.toString(), name: x.name, slug: x.slug } : null);

function productDto(p: Populated, opts: { showCost: boolean; stock?: ProductDto['stock'] }): ProductDto {
  return {
    id: p._id.toString(),
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    productCode: p.productCode ?? null,
    description: p.description,
    category: ref(p.category),
    brand: ref(p.brand),
    images: p.images.map((i) => imageDto(i)!),
    price: p.price,
    discountPrice: p.discountPrice ?? null,
    ...(opts.showCost ? { costPrice: p.costPrice ?? null } : {}),
    specifications: p.specifications.map((s) => ({ label: s.label, value: s.value })),
    hasVariants: p.hasVariants,
    variants: p.variants.map(variantDto),
    tags: p.tags,
    isFeatured: p.isFeatured,
    status: p.status,
    relatedProducts: (p.relatedProducts ?? []).filter(Boolean).map(productRef),
    stock: opts.stock,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function publicProductDto(p: Populated): PublicProductDto {
  return {
    id: p._id.toString(),
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    description: p.description,
    category: ref(p.category),
    brand: ref(p.brand),
    images: p.images.map((i) => imageDto(i)!),
    price: p.price,
    discountPrice: p.discountPrice ?? null,
    specifications: p.specifications.map((s) => ({ label: s.label, value: s.value })),
    hasVariants: p.hasVariants,
    variants: p.variants.filter((v) => v.status === 'active').map(variantDto),
    tags: p.tags,
    isFeatured: p.isFeatured,
  };
}

const POPULATE = [
  { path: 'category', select: 'name slug' },
  { path: 'brand', select: 'name slug' },
  { path: 'relatedProducts', select: 'name sku slug images', match: { status: 'active' } },
];

// ------------------------------------------------------------------ categories

export async function listCategories(auth: AuthContext | null, status?: 'active' | 'inactive'): Promise<CategoryDto[]> {
  const staff = auth?.can(P.PRODUCTS_READ) || auth?.can(P.CATEGORIES_WRITE);
  const all = await Category.find(staff && status ? { status } : {}).sort({ sortOrder: 1, name: 1 });
  if (!staff) {
    // Visitors see active categories whose ancestors are all active too.
    const inactive = new Set(all.filter((c) => c.status !== 'active').map((c) => c._id.toString()));
    return all.filter((c) => c.status === 'active' && !c.ancestors.some((a) => inactive.has(a.toString()))).map((c) => categoryDto(c));
  }
  const counts = await Product.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { status: { $ne: 'inactive' } } },
    { $unwind: '$categoryPath' },
    { $group: { _id: '$categoryPath', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
  return all.map((c) => categoryDto(c, byId.get(c._id.toString()) ?? 0));
}

async function ancestorsFor(parentId: string | null | undefined): Promise<{ parent: Types.ObjectId | null; ancestors: Types.ObjectId[] }> {
  if (!parentId) return { parent: null, ancestors: [] };
  const parent = await Category.findById(parentId).select('ancestors');
  if (!parent) throw badRequest('The parent category does not exist.', { parent: ['Not found'] });
  return { parent: parent._id, ancestors: [...parent.ancestors, parent._id] };
}

export async function createCategory(input: z.output<typeof categorySchema>, auth: AuthContext, meta: RequestMeta): Promise<CategoryDto> {
  return withTransaction(async () => {
    const tree = await ancestorsFor(input.parent);
    if (tree.ancestors.length >= 4) throw badRequest('Categories can be nested at most 4 levels deep.');
    const [cat] = await Category.create([{ ...input, ...tree, slug: await uniqueSlug(Category, input.name) }]);
    await audit({ action: 'category.created', actor: auth, entity: { kind: 'Category', id: cat!._id, label: cat!.name }, after: pick(cat, ['name', 'parent', 'status']) }, meta);
    return categoryDto(cat!);
  });
}

export async function updateCategory(id: string, input: z.output<typeof updateCategorySchema>, auth: AuthContext, meta: RequestMeta): Promise<CategoryDto> {
  return withTransaction(async () => {
    const cat = await Category.findById(id);
    if (!cat) throw notFound('Category');
    const before = pick(cat, ['name', 'parent', 'status', 'sortOrder', 'description']);

    if (input.parent !== undefined && String(input.parent ?? '') !== String(cat.parent ?? '')) {
      if (input.parent === id) throw badRequest('A category cannot be its own parent.');
      const tree = await ancestorsFor(input.parent);
      if (tree.ancestors.some((a) => a.equals(cat._id))) throw badRequest('A category cannot be moved inside its own subcategory.');
      const oldPrefixLen = cat.ancestors.length + 1;
      cat.parent = tree.parent;
      cat.ancestors = tree.ancestors;
      // Re-root every descendant and every product filed under this subtree.
      const descendants = await Category.find({ ancestors: cat._id });
      for (const d of descendants) {
        d.ancestors = [...tree.ancestors, cat._id, ...d.ancestors.slice(oldPrefixLen)];
        if (d.ancestors.length > 4) throw badRequest('That move would nest categories more than 4 levels deep.');
        await d.save();
      }
      const affected = [cat._id, ...descendants.map((d) => d._id)];
      const pathFor = new Map<string, Types.ObjectId[]>([[cat._id.toString(), [...tree.ancestors, cat._id]], ...descendants.map((d) => [d._id.toString(), [...d.ancestors, d._id]] as [string, Types.ObjectId[]])]);
      for (const p of await Product.find({ category: { $in: affected } }).select('category')) {
        await Product.updateOne({ _id: p._id }, { $set: { categoryPath: pathFor.get(p.category.toString()) } });
      }
    }
    if (input.name && input.name !== cat.name) {
      cat.name = input.name;
      cat.slug = await uniqueSlug(Category, input.name, cat._id);
    }
    for (const k of ['description', 'sortOrder', 'status'] as const) if (input[k] !== undefined) cat.set(k, input[k]);
    await cat.save();
    await audit({ action: 'category.updated', actor: auth, entity: { kind: 'Category', id: cat._id, label: cat.name }, before, after: pick(cat, ['name', 'parent', 'status', 'sortOrder', 'description']) }, meta);
    return categoryDto(cat);
  });
}

export async function deleteCategory(id: string, auth: AuthContext, meta: RequestMeta): Promise<void> {
  await withTransaction(async () => {
    const cat = await Category.findById(id);
    if (!cat) throw notFound('Category');
    const [children, products] = await Promise.all([Category.countDocuments({ parent: cat._id }), Product.countDocuments({ category: cat._id })]);
    if (children || products) {
      throw conflict(
        `This category still has ${children ? `${children} subcategor${children === 1 ? 'y' : 'ies'}` : ''}${children && products ? ' and ' : ''}${products ? `${products} product${products === 1 ? '' : 's'}` : ''}. Move them or deactivate the category instead.`,
        undefined,
        'IN_USE',
      );
    }
    await cat.deleteOne();
    await audit({ action: 'category.deleted', actor: auth, entity: { kind: 'Category', id: cat._id, label: cat.name } }, meta);
    removeImagesLater([cat.image?.publicId]);
  });
}

export async function setCategoryImage(id: string, file: UploadedFile | undefined, auth: AuthContext, meta: RequestMeta): Promise<CategoryDto> {
  if (!file) throw badRequest('Choose an image to upload.');
  const cat = await Category.findById(id);
  if (!cat) throw notFound('Category');
  const stored = await storeImage(file, 'categories');
  const old = cat.image?.publicId;
  cat.image = { _id: new Types.ObjectId(), url: stored.url, publicId: stored.publicId, width: stored.width, height: stored.height, alt: cat.name };
  await cat.save();
  removeImagesLater([old]);
  await audit({ action: 'category.image_changed', actor: auth, entity: { kind: 'Category', id: cat._id, label: cat.name } }, meta);
  return categoryDto(cat);
}

// ------------------------------------------------------------------ brands

export async function listBrands(auth: AuthContext | null, status?: 'active' | 'inactive'): Promise<BrandDto[]> {
  const staff = auth?.can(P.PRODUCTS_READ) || auth?.can(P.BRANDS_WRITE);
  const brands = await Brand.find(staff ? (status ? { status } : {}) : { status: 'active' }).sort({ name: 1 });
  if (!staff) return brands.map((b) => brandDto(b));
  const counts = await Product.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { status: { $ne: 'inactive' }, brand: { $ne: null } } },
    { $group: { _id: '$brand', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
  return brands.map((b) => brandDto(b, byId.get(b._id.toString()) ?? 0));
}

export async function createBrand(input: z.output<typeof brandSchema>, auth: AuthContext, meta: RequestMeta): Promise<BrandDto> {
  return withTransaction(async () => {
    const [brand] = await Brand.create([{ ...input, slug: await uniqueSlug(Brand, input.name) }]);
    await audit({ action: 'brand.created', actor: auth, entity: { kind: 'Brand', id: brand!._id, label: brand!.name } }, meta);
    return brandDto(brand!);
  });
}

export async function updateBrand(id: string, input: z.output<typeof updateBrandSchema>, auth: AuthContext, meta: RequestMeta): Promise<BrandDto> {
  return withTransaction(async () => {
    const brand = await Brand.findById(id);
    if (!brand) throw notFound('Brand');
    const before = pick(brand, ['name', 'description', 'website', 'status']);
    if (input.name && input.name !== brand.name) {
      brand.name = input.name;
      brand.slug = await uniqueSlug(Brand, input.name, brand._id);
    }
    for (const k of ['description', 'website', 'status'] as const) if (input[k] !== undefined) brand.set(k, input[k]);
    await brand.save();
    await audit({ action: 'brand.updated', actor: auth, entity: { kind: 'Brand', id: brand._id, label: brand.name }, before, after: pick(brand, ['name', 'description', 'website', 'status']) }, meta);
    return brandDto(brand);
  });
}

export async function deleteBrand(id: string, auth: AuthContext, meta: RequestMeta): Promise<void> {
  const brand = await Brand.findById(id);
  if (!brand) throw notFound('Brand');
  const n = await Product.countDocuments({ brand: brand._id });
  if (n) throw conflict(`${n} product${n === 1 ? ' uses' : 's use'} this brand. Deactivate it instead.`, undefined, 'IN_USE');
  await brand.deleteOne();
  removeImagesLater([brand.logo?.publicId]);
  await audit({ action: 'brand.deleted', actor: auth, entity: { kind: 'Brand', id: brand._id, label: brand.name } }, meta);
}

export async function setBrandLogo(id: string, file: UploadedFile | undefined, auth: AuthContext, meta: RequestMeta): Promise<BrandDto> {
  if (!file) throw badRequest('Choose an image to upload.');
  const brand = await Brand.findById(id);
  if (!brand) throw notFound('Brand');
  const stored = await storeImage(file, 'brands');
  const old = brand.logo?.publicId;
  brand.logo = { _id: new Types.ObjectId(), url: stored.url, publicId: stored.publicId, width: stored.width, height: stored.height, alt: brand.name };
  await brand.save();
  removeImagesLater([old]);
  await audit({ action: 'brand.logo_changed', actor: auth, entity: { kind: 'Brand', id: brand._id, label: brand.name } }, meta);
  return brandDto(brand);
}

// ------------------------------------------------------------------ products

async function categoryPathFor(categoryId: string): Promise<Types.ObjectId[]> {
  const cat = await Category.findById(categoryId).select('ancestors');
  if (!cat) throw badRequest('Choose an existing category.', { category: ['Category not found'] });
  return [...cat.ancestors, cat._id];
}

async function assertBrand(brandId: string | null | undefined) {
  if (brandId && !(await Brand.exists({ _id: brandId }))) throw badRequest('Choose an existing brand.', { brand: ['Brand not found'] });
}

/** SKUs are unique across product SKUs and variant SKUs of every product. */
async function assertSkusFree(skus: string[], excludeProduct?: Types.ObjectId) {
  if (!skus.length) return;
  const clash = await Product.findOne({
    ...(excludeProduct ? { _id: { $ne: excludeProduct } } : {}),
    $or: [{ sku: { $in: skus } }, { 'variants.sku': { $in: skus } }],
  }).select('name sku variants.sku');
  if (clash) {
    const taken = skus.filter((s) => clash.sku === s || clash.variants.some((v) => v.sku === s));
    throw conflict(`SKU ${taken.join(', ')} is already used by "${clash.name}".`, { sku: [`Already used by ${clash.name}`] }, 'DUPLICATE');
  }
}

function ruleCheck(p: Parameters<typeof productRuleIssues>[0]) {
  const issues = productRuleIssues(p);
  if (issues.length) {
    const details: Record<string, string[]> = {};
    for (const i of issues) (details[i.path] ??= []).push(i.message);
    throw unprocessable(issues[0]!.message, details);
  }
}

async function stockSummary(auth: AuthContext, productIds: Types.ObjectId[], branch?: string) {
  if (!auth.can(P.INVENTORY_READ) || !productIds.length) return new Map<string, ProductDto['stock']>();
  const match: Record<string, unknown> = { product: { $in: productIds }, ...auth.branchFilter(P.INVENTORY_READ) };
  if (branch) {
    if (!auth.canAccessBranch(P.INVENTORY_READ, branch)) return new Map();
    match.branch = new Types.ObjectId(branch);
  }
  const rows = await Inventory.aggregate<{ _id: Types.ObjectId; q: number; r: number }>([
    { $match: match },
    { $group: { _id: '$product', q: { $sum: '$quantity' }, r: { $sum: '$reserved' } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), { onHand: r.q, reserved: r.r, available: r.q - r.r }]));
}

type ListQuery = z.output<typeof listProductsQuery>;

/** Staff see every product (with stock in their branches); visitors see active products only. */
export async function listProducts(q: ListQuery, auth: AuthContext | null): Promise<Page<ProductDto | PublicProductDto>> {
  const staff = auth?.can(P.PRODUCTS_READ) ? auth : null;
  const filter: Record<string, unknown> = staff ? (q.status ? { status: q.status } : {}) : { status: 'active' };
  if (q.category) filter.categoryPath = new Types.ObjectId(q.category);
  if (q.brand) filter.brand = new Types.ObjectId(q.brand);
  if (q.featured !== undefined) filter.isFeatured = q.featured;
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    filter.effectivePrice = { ...(q.minPrice !== undefined ? { $gte: q.minPrice } : {}), ...(q.maxPrice !== undefined ? { $lte: q.maxPrice } : {}) };
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { 'variants.sku': rx }, { tags: q.q.toLowerCase() }, { productCode: rx }];
  }
  if (q.inStock && q.branch) {
    const ids = await Inventory.distinct('product', {
      branch: new Types.ObjectId(q.branch),
      isAvailable: true,
      $expr: { $gt: [{ $subtract: ['$quantity', '$reserved'] }, 0] },
    });
    filter._id = { $in: ids };
  }
  const sort: Record<string, 1 | -1> =
    q.sort === 'name' ? { name: 1 } : q.sort === 'price_asc' ? { effectivePrice: 1, _id: 1 } : q.sort === 'price_desc' ? { effectivePrice: -1, _id: 1 } : { createdAt: -1, _id: -1 };

  const query = Product.find(filter).sort(sort).skip(skipFor(q.page, q.limit)).limit(q.limit).populate(POPULATE);
  if (staff?.can(P.INVENTORY_READ_COST)) query.select('+costPrice');
  const [items, total] = await Promise.all([query.lean<Populated[]>(), Product.countDocuments(filter)]);

  if (!staff) return Page.of(items.map(publicProductDto), total, q.page, q.limit);
  const stock = await stockSummary(staff, items.map((p) => p._id), q.branch);
  const showCost = staff.can(P.INVENTORY_READ_COST);
  return Page.of(items.map((p) => productDto(p, { showCost, stock: stock.get(p._id.toString()) ?? (staff.can(P.INVENTORY_READ) ? { onHand: 0, reserved: 0, available: 0 } : undefined) })), total, q.page, q.limit);
}

export async function getProduct(idOrSlug: string, auth: AuthContext | null): Promise<ProductDto | PublicProductDto> {
  const staff = auth?.can(P.PRODUCTS_READ) ? auth : null;
  const byId = /^[a-f\d]{24}$/i.test(idOrSlug);
  const query = Product.findOne(byId ? { _id: idOrSlug } : { slug: idOrSlug.toLowerCase() }).populate(POPULATE);
  if (staff?.can(P.INVENTORY_READ_COST)) query.select('+costPrice');
  const p = await query.lean<Populated>();
  if (!p) throw notFound('Product');
  if (!staff) {
    if (p.status !== 'active') throw notFound('Product');
    return publicProductDto(p);
  }
  const stock = await stockSummary(staff, [p._id]);
  return productDto(p, { showCost: staff.can(P.INVENTORY_READ_COST), stock: stock.get(p._id.toString()) ?? { onHand: 0, reserved: 0, available: 0 } });
}

async function loadStaffProduct(id: Types.ObjectId, auth: AuthContext): Promise<ProductDto> {
  return getProduct(id.toString(), auth) as Promise<ProductDto>;
}

const AUDIT_FIELDS = ['name', 'sku', 'status', 'price', 'discountPrice', 'category', 'brand', 'isFeatured', 'hasVariants'] as const;

function applyVariants(product: ProductDoc, incoming: z.output<typeof productSchema>['variants']) {
  const next = incoming.map((v) => {
    const existing = v.id ? product.variants.id(v.id) : null;
    if (v.id && !existing) throw badRequest(`Variant ${v.id} does not belong to this product.`);
    return {
      _id: existing?._id ?? new Types.ObjectId(),
      sku: v.sku,
      size: v.size,
      color: v.color,
      price: v.price ?? null,
      discountPrice: v.discountPrice ?? null,
      status: v.status,
    };
  });
  const removed = product.variants.filter((v) => !next.some((n) => n._id.equals(v._id))).map((v) => v._id);
  product.set('variants', next);
  return removed;
}

/** Refuses to drop variants (or switch variant mode) while stock or reservations exist for them. */
async function assertNoStockFor(productId: Types.ObjectId, variantIds: (Types.ObjectId | null)[]) {
  if (!variantIds.length) return;
  const held = await Inventory.findOne({
    product: productId,
    variantId: { $in: variantIds },
    $or: [{ quantity: { $gt: 0 } }, { reserved: { $gt: 0 } }],
  }).populate('branch', 'code');
  if (held) {
    throw conflict(
      `Stock is still held for this item at ${(held.branch as unknown as { code: string }).code}. Move or remove the stock first, or mark the variant inactive instead.`,
      undefined,
      'HAS_STOCK',
    );
  }
}

export async function createProduct(input: z.output<typeof productSchema>, auth: AuthContext, meta: RequestMeta): Promise<ProductDto> {
  const id = await withTransaction(async () => {
    const categoryPath = await categoryPathFor(input.category);
    await assertBrand(input.brand);
    await assertSkusFree([input.sku, ...input.variants.map((v) => v.sku)]);
    const product = new Product({
      ...input,
      variants: [],
      categoryPath,
      slug: await uniqueSlug(Product, input.name),
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    applyVariants(product, input.hasVariants ? input.variants : []);
    await product.save();
    await audit({ action: 'product.created', actor: auth, entity: { kind: 'Product', id: product._id, label: `${product.sku} · ${product.name}` }, after: pick(product, AUDIT_FIELDS) }, meta);
    return product._id;
  });
  return loadStaffProduct(id, auth);
}

export async function updateProduct(id: string, input: z.output<typeof updateProductSchema>, auth: AuthContext, meta: RequestMeta): Promise<ProductDto> {
  await withTransaction(async () => {
    const product = await Product.findById(id).select('+costPrice');
    if (!product) throw notFound('Product');
    const before = pick(product, AUDIT_FIELDS);

    if (input.category && input.category !== product.category.toString()) product.categoryPath = await categoryPathFor(input.category);
    if (input.brand !== undefined) await assertBrand(input.brand);

    const nextHasVariants = input.hasVariants ?? product.hasVariants;
    const nextVariants = input.variants ?? product.variants.map((v) => ({ ...v.toObject(), id: v._id.toString() }));
    ruleCheck({
      price: input.price ?? product.price,
      discountPrice: input.discountPrice !== undefined ? input.discountPrice : product.discountPrice,
      hasVariants: nextHasVariants,
      variants: nextHasVariants ? nextVariants : [],
      sku: input.sku ?? product.sku,
    });
    const newSkus = [input.sku, ...(nextHasVariants ? nextVariants.map((v) => v.sku) : [])].filter(
      (s): s is string => Boolean(s) && s !== product.sku && !product.variants.some((v) => v.sku === s),
    );
    await assertSkusFree(newSkus, product._id);

    // Switching variant mode: existing stock belongs to the old shape.
    if (nextHasVariants !== product.hasVariants) {
      await assertNoStockFor(product._id, product.hasVariants ? product.variants.map((v) => v._id) : [null]);
    }

    const { variants, category, brand, ...rest } = input;
    product.set(rest);
    if (category) product.category = new Types.ObjectId(category);
    if (brand !== undefined) product.brand = brand ? new Types.ObjectId(brand) : null;
    if (input.name && input.name !== before.name) product.slug = await uniqueSlug(Product, input.name, product._id);

    if (variants !== undefined || nextHasVariants !== product.hasVariants) {
      const removed = applyVariants(product, nextHasVariants ? (variants ?? (nextVariants as z.output<typeof productSchema>['variants'])) : []);
      await assertNoStockFor(product._id, removed);
      if (removed.length) await Inventory.deleteMany({ product: product._id, variantId: { $in: removed }, quantity: 0, reserved: 0 });
    }
    // Keep inventory SKUs in step with product and variant SKUs.
    if (input.sku && !product.hasVariants) await Inventory.updateMany({ product: product._id, variantId: null }, { $set: { sku: product.sku } });
    for (const v of product.variants) await Inventory.updateMany({ product: product._id, variantId: v._id }, { $set: { sku: v.sku } });

    product.updatedBy = new Types.ObjectId(auth.userId);
    await product.save();
    await audit({ action: 'product.updated', actor: auth, entity: { kind: 'Product', id: product._id, label: `${product.sku} · ${product.name}` }, before, after: pick(product, AUDIT_FIELDS) }, meta);
  });
  return loadStaffProduct(new Types.ObjectId(id), auth);
}

export async function addProductImages(id: string, files: UploadedFile[], auth: AuthContext, meta: RequestMeta): Promise<ProductDto> {
  if (!files.length) throw badRequest('Choose at least one image.');
  const product = await Product.findById(id);
  if (!product) throw notFound('Product');
  if (product.images.length + files.length > MAX_PRODUCT_IMAGES) {
    throw badRequest(`A product can have at most ${MAX_PRODUCT_IMAGES} images (it has ${product.images.length}).`);
  }
  const stored = [];
  try {
    for (const f of files) stored.push(await storeImage(f, 'products'));
  } catch (err) {
    removeImagesLater(stored.map((s) => s.publicId));
    throw err;
  }
  // Atomic append: concurrent uploads cannot overwrite each other.
  await Product.updateOne(
    { _id: product._id },
    { $push: { images: { $each: stored.map((s) => ({ url: s.url, publicId: s.publicId, width: s.width, height: s.height, alt: product.name })) } } },
  );
  await audit({ action: 'product.images_added', actor: auth, entity: { kind: 'Product', id: product._id, label: product.name }, meta: { count: stored.length } }, meta);
  return loadStaffProduct(product._id, auth);
}

export async function updateProductImages(id: string, input: z.output<typeof productImagesUpdateSchema>, auth: AuthContext): Promise<ProductDto> {
  const product = await Product.findById(id);
  if (!product) throw notFound('Product');
  const current = new Map(product.images.map((i) => [i._id.toString(), i]));
  if (input.images.length !== current.size || input.images.some((i) => !current.has(i.id))) {
    throw badRequest('Send every current image exactly once, in the new order.');
  }
  product.set('images', input.images.map((i) => ({ ...current.get(i.id)!.toObject(), alt: i.alt ?? product.name })));
  await product.save();
  return loadStaffProduct(product._id, auth);
}

export async function removeProductImage(id: string, imageId: string, auth: AuthContext, meta: RequestMeta): Promise<ProductDto> {
  const product = await Product.findById(id);
  if (!product) throw notFound('Product');
  const img = product.images.id(imageId);
  if (!img) throw notFound('Image');
  await Product.updateOne({ _id: product._id }, { $pull: { images: { _id: img._id } } });
  removeImagesLater([img.publicId]);
  await audit({ action: 'product.image_removed', actor: auth, entity: { kind: 'Product', id: product._id, label: product.name } }, meta);
  return loadStaffProduct(product._id, auth);
}

export async function relatedProducts(slug: string): Promise<PublicProductDto[]> {
  const p = await Product.findOne({ slug, status: 'active' }).select('relatedProducts category brand');
  if (!p) throw notFound('Product');
  let items: Populated[] = [];
  if (p.relatedProducts.length) {
    items = await Product.find({ _id: { $in: p.relatedProducts }, status: 'active' }).populate(POPULATE).lean<Populated[]>();
  }
  if (items.length < 8) {
    const more = await Product.find({
      _id: { $nin: [p._id, ...items.map((i) => i._id)] },
      status: 'active',
      $or: [{ category: p.category }, ...(p.brand ? [{ brand: p.brand }] : [])],
    })
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(8 - items.length)
      .populate(POPULATE)
      .lean<Populated[]>();
    items = [...items, ...more];
  }
  return items.map(publicProductDto);
}

export function stockLevel(available: number, isAvailable: boolean, threshold: number): StockLevel {
  if (!isAvailable || available <= 0) return 'out';
  return available <= threshold ? 'low' : 'in_stock';
}

const LEVEL_RANK: Record<StockLevel, number> = { out: 0, low: 1, in_stock: 2 };

/**
 * Which active branches have the product, as levels (in stock / low / out), never exact
 * quantities. Branches without any record show as out of stock, so customers can be pointed elsewhere.
 */
export async function productAvailability(slug: string): Promise<BranchAvailabilityDto[]> {
  const product = await Product.findOne({ slug, status: 'active' }).select('hasVariants variants');
  if (!product) throw notFound('Product');
  const [branches, rows, settings] = await Promise.all([
    Branch.find({ status: 'active' }).select('name code city state whatsapp phone').sort({ state: 1, name: 1 }).lean(),
    Inventory.find({ product: product._id }).lean(),
    getSettingsDoc(),
  ]);
  const variantKeys = product.hasVariants ? product.variants.filter((v) => v.status === 'active').map((v) => v._id.toString()) : [''];
  return branches.map((b) => {
    const levels: Record<string, StockLevel> = {};
    for (const key of variantKeys) {
      const row = rows.find((r) => r.branch.equals(b._id) && String(r.variantId ?? '') === key);
      levels[key] = row ? stockLevel(row.quantity - row.reserved, row.isAvailable, row.reorderLevel ?? settings.lowStockDefault) : 'out';
    }
    const level = (Object.values(levels).sort((a, c) => LEVEL_RANK[c] - LEVEL_RANK[a])[0] ?? 'out') as StockLevel;
    return {
      branch: { id: b._id.toString(), name: b.name, code: b.code, city: b.city, state: b.state, whatsapp: b.whatsapp, phone: b.phone },
      levels,
      level,
    };
  });
}

/** Lookup used by inventory, transfers and enquiries: validates the product and variant pairing. */
export async function resolveStockItem(productId: string, variantId: string | null) {
  const product = await Product.findById(productId).select('name sku hasVariants variants status images slug');
  if (!product) throw badRequest('A selected product no longer exists.', { product: ['Not found'] });
  if (product.hasVariants) {
    if (!variantId) throw badRequest(`Choose a variant (size or colour) for ${product.name}.`, { variantId: ['Required'] });
    const v = product.variants.id(variantId);
    if (!v) throw badRequest(`That variant does not belong to ${product.name}.`);
    return { product, variant: v, sku: v.sku, name: `${product.name} (${variantLabel(v)})` };
  }
  if (variantId) throw badRequest(`${product.name} has no variants.`);
  return { product, variant: null, sku: product.sku, name: product.name };
}

