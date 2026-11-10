import {
  PERMISSIONS,
  brandSchema,
  categorySchema,
  idParams,
  listCategoriesQuery,
  listProductsQuery,
  objectId,
  productImagesUpdateSchema,
  productSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateProductSchema,
} from '@mb/shared';
import { z } from 'zod';
import type { ModuleRouter } from '../../core/http/route';
import {
  addProductImages,
  createBrand,
  createCategory,
  createProduct,
  deleteBrand,
  deleteCategory,
  getProduct,
  listBrands,
  listCategories,
  listProducts,
  productAvailability,
  relatedProducts,
  removeProductImage,
  setBrandLogo,
  setCategoryImage,
  updateBrand,
  updateCategory,
  updateProduct,
  updateProductImages,
} from './catalog.service';

const P = PERMISSIONS;
const slugParams = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,100}$/) });
const idOrSlugParams = z.object({ idOrSlug: z.string().trim().regex(/^[a-zA-Z0-9-]{1,100}$/) });

export function registerCategoryRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'List categories (flat; build the tree from parent/ancestors)',
    description: 'Visitors get active categories. Staff get all categories with product counts.',
    auth: 'optional',
    query: listCategoriesQuery,
    handler: ({ query, maybeAuth }) => listCategories(maybeAuth, query.status),
  });
  m.route({ method: 'post', path: '/', summary: 'Create a category', permission: P.CATEGORIES_WRITE, body: categorySchema, handler: ({ body, auth, meta }) => createCategory(body, auth, meta) });
  m.route({ method: 'patch', path: '/:id', summary: 'Update or move a category', permission: P.CATEGORIES_WRITE, params: idParams, body: updateCategorySchema, handler: ({ params, body, auth, meta }) => updateCategory(params.id, body, auth, meta) });
  m.route({ method: 'delete', path: '/:id', summary: 'Delete an unused category', permission: P.CATEGORIES_WRITE, params: idParams, status: 204, handler: ({ params, auth, meta }) => deleteCategory(params.id, auth, meta) });
  m.route({
    method: 'post',
    path: '/:id/image',
    summary: 'Upload or replace the category image (JPG, PNG or WebP)',
    permission: P.CATEGORIES_WRITE,
    params: idParams,
    upload: { field: 'image', maxCount: 1 },
    status: 200,
    handler: ({ params, files, auth, meta }) => setCategoryImage(params.id, files[0], auth, meta),
  });
}

export function registerBrandRoutes(m: ModuleRouter): void {
  m.route({ method: 'get', path: '/', summary: 'List brands', auth: 'optional', query: listCategoriesQuery, handler: ({ query, maybeAuth }) => listBrands(maybeAuth, query.status) });
  m.route({ method: 'post', path: '/', summary: 'Create a brand', permission: P.BRANDS_WRITE, body: brandSchema, handler: ({ body, auth, meta }) => createBrand(body, auth, meta) });
  m.route({ method: 'patch', path: '/:id', summary: 'Update a brand', permission: P.BRANDS_WRITE, params: idParams, body: updateBrandSchema, handler: ({ params, body, auth, meta }) => updateBrand(params.id, body, auth, meta) });
  m.route({ method: 'delete', path: '/:id', summary: 'Delete an unused brand', permission: P.BRANDS_WRITE, params: idParams, status: 204, handler: ({ params, auth, meta }) => deleteBrand(params.id, auth, meta) });
  m.route({
    method: 'post',
    path: '/:id/logo',
    summary: 'Upload or replace the brand logo',
    permission: P.BRANDS_WRITE,
    params: idParams,
    upload: { field: 'image', maxCount: 1 },
    status: 200,
    handler: ({ params, files, auth, meta }) => setBrandLogo(params.id, files[0], auth, meta),
  });
}

export function registerProductRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'Search and filter products',
    description: 'Visitors see active products. Staff see every status, plus stock in their branches; cost prices need inventory:read-cost.',
    auth: 'optional',
    query: listProductsQuery,
    handler: ({ query, maybeAuth }) => listProducts(query, maybeAuth),
  });
  m.route({
    method: 'get',
    path: '/:idOrSlug',
    summary: 'Get a product by id (staff) or slug',
    auth: 'optional',
    params: idOrSlugParams,
    handler: ({ params, maybeAuth }) => getProduct(params.idOrSlug, maybeAuth),
  });
  m.route({
    method: 'get',
    path: '/:slug/availability',
    summary: 'Stock level per branch (in stock / low / out). Exact quantities are never exposed.',
    auth: 'none',
    params: slugParams,
    handler: ({ params }) => productAvailability(params.slug),
  });
  m.route({ method: 'get', path: '/:slug/related', summary: 'Related products', auth: 'none', params: slugParams, handler: ({ params }) => relatedProducts(params.slug) });
  m.route({ method: 'post', path: '/', summary: 'Create a product', permission: P.PRODUCTS_WRITE, body: productSchema, handler: ({ body, auth, meta }) => createProduct(body, auth, meta) });
  m.route({
    method: 'patch',
    path: '/:id',
    summary: 'Update a product (including variants and status)',
    permission: P.PRODUCTS_WRITE,
    params: idParams,
    body: updateProductSchema,
    handler: ({ params, body, auth, meta }) => updateProduct(params.id, body, auth, meta),
  });
  m.route({
    method: 'post',
    path: '/:id/images',
    summary: 'Upload product images (up to 12 per product, 5 MB each)',
    permission: P.PRODUCTS_WRITE,
    params: idParams,
    upload: { field: 'images', maxCount: 8 },
    handler: ({ params, files, auth, meta }) => addProductImages(params.id, files, auth, meta),
  });
  m.route({
    method: 'put',
    path: '/:id/images',
    summary: 'Reorder images and set alt text (the first image is the main photo)',
    permission: P.PRODUCTS_WRITE,
    params: idParams,
    body: productImagesUpdateSchema,
    handler: ({ params, body, auth }) => updateProductImages(params.id, body, auth),
  });
  m.route({
    method: 'delete',
    path: '/:id/images/:imageId',
    summary: 'Remove a product image',
    permission: P.PRODUCTS_WRITE,
    params: z.object({ id: objectId, imageId: objectId }),
    status: 200,
    handler: ({ params, auth, meta }) => removeProductImage(params.id, params.imageId, auth, meta),
  });
}
