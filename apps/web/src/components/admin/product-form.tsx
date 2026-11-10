'use client';

import { CATALOG_STATUSES, type CategoryDto, PRODUCT_STATUSES, type ProductDto, productRuleIssues, productSchema, updateProductSchema } from '@mb/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, type FieldPath, useFieldArray, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/display';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/field';
import { ApiError, errorMessage } from '@/lib/api';
import { useBrands, useCategories } from '@/lib/queries';
import { nairaInputValue, parseNaira } from '@/lib/utils';
import { NairaInput } from './commerce';

interface VariantRow { id?: string; sku: string; size: string; color: string; price: string; discountPrice: string; status: 'active' | 'inactive' }
export interface ProductFormValues {
  name: string;
  sku: string;
  productCode: string;
  category: string;
  brand: string;
  price: string;
  discountPrice: string;
  costPrice: string;
  description: string;
  specifications: { label: string; value: string }[];
  tags: string;
  isFeatured: boolean;
  status: (typeof PRODUCT_STATUSES)[number];
  hasVariants: boolean;
  variants: VariantRow[];
}

function initial(p?: ProductDto): ProductFormValues {
  return {
    name: p?.name ?? '',
    sku: p?.sku ?? '',
    productCode: p?.productCode ?? '',
    category: p?.category?.id ?? '',
    brand: p?.brand?.id ?? '',
    price: nairaInputValue(p?.price),
    discountPrice: nairaInputValue(p?.discountPrice),
    costPrice: nairaInputValue(p?.costPrice),
    description: p?.description ?? '',
    specifications: p?.specifications ?? [],
    tags: (p?.tags ?? []).join(', '),
    isFeatured: p?.isFeatured ?? false,
    status: p?.status ?? 'draft',
    hasVariants: p?.hasVariants ?? false,
    variants: (p?.variants ?? []).map((v) => ({ id: v.id, sku: v.sku, size: v.size ?? '', color: v.color ?? '', price: nairaInputValue(v.price), discountPrice: nairaInputValue(v.discountPrice), status: v.status })),
  };
}

/** Indented category options: "Electronics", "— Televisions". */
export function categoryOptions(categories: CategoryDto[] | undefined) {
  const list = categories ?? [];
  const children = (parent: string | null): CategoryDto[] => list.filter((c) => c.parent === parent).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const out: { id: string; label: string; status: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of children(parent)) {
      out.push({ id: c.id, label: `${'— '.repeat(depth)}${c.name}`, status: c.status });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function ProductForm({ product, showCost, submitLabel, onSubmit }: { product?: ProductDto; showCost: boolean; submitLabel: string; onSubmit: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const categories = useCategories();
  const brands = useBrands();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ProductFormValues>({ defaultValues: initial(product) });
  const { register, control, handleSubmit, setError, formState, watch } = form;
  const { errors, isSubmitting, isDirty } = formState;
  const specs = useFieldArray({ control, name: 'specifications' });
  const variants = useFieldArray({ control, name: 'variants' });
  const hasVariants = watch('hasVariants');
  const cats = useMemo(() => categoryOptions(categories.data), [categories.data]);

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    const money = (field: FieldPath<ProductFormValues>, s: string, required = false) => {
      const k = parseNaira(s);
      if (Number.isNaN(k) || (required && k === null)) {
        setError(field, { message: required && k === null ? 'Enter an amount' : 'Enter an amount like 250000 or 1250.50' });
        throw new Error('invalid');
      }
      return k;
    };
    let payload: Record<string, unknown>;
    try {
      payload = {
        name: v.name,
        sku: v.sku,
        productCode: v.productCode.trim() || undefined,
        category: v.category,
        brand: v.brand || null,
        price: money('price', v.price, true),
        discountPrice: money('discountPrice', v.discountPrice),
        ...(showCost ? { costPrice: money('costPrice', v.costPrice) } : {}),
        description: v.description,
        specifications: v.specifications.filter((s) => s.label.trim() || s.value.trim()),
        tags: v.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        isFeatured: v.isFeatured,
        status: v.status,
        hasVariants: v.hasVariants,
        variants: v.hasVariants
          ? v.variants.map((x, i) => ({
              ...(x.id ? { id: x.id } : {}),
              sku: x.sku,
              size: x.size.trim() || undefined,
              color: x.color.trim() || undefined,
              price: money(`variants.${i}.price`, x.price),
              discountPrice: money(`variants.${i}.discountPrice`, x.discountPrice),
              status: x.status,
            }))
          : [],
      };
    } catch {
      return;
    }

    const parsed = (product ? updateProductSchema : productSchema).safeParse(payload);
    const issues = parsed.success
      ? productRuleIssues(parsed.data as Parameters<typeof productRuleIssues>[0]).map((i) => ({ path: i.path, message: i.message }))
      : parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    if (issues.length) {
      for (const i of issues) setError((i.path === 'variants' ? 'hasVariants' : i.path) as FieldPath<ProductFormValues>, { message: i.message });
      setFormError(issues[0]!.message);
      return;
    }
    try {
      await onSubmit(payload);
      if (product) form.reset(v);
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [p, m] of Object.entries(err.fieldErrors)) if (p in v) setError(p as FieldPath<ProductFormValues>, { message: m[0] });
      }
      setFormError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {formError && <Alert>{formError}</Alert>}
      <Card>
        <CardHeader title="Product" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name?.message} required className="sm:col-span-2">
            {(p) => <Input {...p} {...register('name')} placeholder='Samsung 55" QLED Smart TV' />}
          </Field>
          <Field label="SKU" error={errors.sku?.message} required hint="Letters, digits and dashes. Printed on labels and receipts.">
            {(p) => <Input {...p} className="font-mono uppercase" {...register('sku')} placeholder="SAM-TV-055" />}
          </Field>
          <Field label="Product code / barcode" error={errors.productCode?.message}>
            {(p) => <Input {...p} {...register('productCode')} />}
          </Field>
          <Field label="Category" error={errors.category?.message} required>
            {(p) => (
              <Select {...p} {...register('category')}>
                <option value="">Choose a category</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.label}{c.status !== 'active' ? ' (inactive)' : ''}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Brand" error={errors.brand?.message}>
            {(p) => (
              <Select {...p} {...register('brand')}>
                <option value="">No brand</option>
                {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={5} {...register('description')} />}
          </Field>
          <Field label="Tags" hint="Comma separated, e.g. smart tv, 4k" className="sm:col-span-2">
            {(p) => <Input {...p} {...register('tags')} />}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pricing" description="Prices are in naira, VAT inclusive (see company settings)." />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Selling price" error={errors.price?.message} required>{(p) => <NairaInput {...p} {...register('price')} placeholder="650000" />}</Field>
          <Field label="Discounted price" error={errors.discountPrice?.message} hint="Leave empty for no discount.">{(p) => <NairaInput {...p} {...register('discountPrice')} />}</Field>
          {showCost && <Field label="Cost price" error={errors.costPrice?.message} hint="Private. Used for stock value.">{(p) => <NairaInput {...p} {...register('costPrice')} />}</Field>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Variants"
          description="Sizes or colours that are stocked separately, each with its own SKU."
          actions={<Controller control={control} name="hasVariants" render={({ field }) => <Switch checked={field.value} onChange={(on) => { field.onChange(on); if (on && variants.fields.length === 0) variants.append({ sku: '', size: '', color: '', price: '', discountPrice: '', status: 'active' }); }} label="Has variants" />} />}
        />
        {errors.hasVariants && <p role="alert" className="px-5 pt-3 text-sm text-danger-700">{errors.hasVariants.message}</p>}
        {hasVariants && (
          <CardBody className="space-y-3">
            {variants.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_1.3fr_1fr_1fr_auto_auto] sm:items-end">
                <Field label="Size" error={errors.variants?.[i]?.size?.message}>{(p) => <Input {...p} {...register(`variants.${i}.size`)} placeholder="L" />}</Field>
                <Field label="Colour" error={errors.variants?.[i]?.color?.message}>{(p) => <Input {...p} {...register(`variants.${i}.color`)} placeholder="Black" />}</Field>
                <Field label="SKU" error={errors.variants?.[i]?.sku?.message} required>{(p) => <Input {...p} className="font-mono uppercase" {...register(`variants.${i}.sku`)} />}</Field>
                <Field label="Price" error={errors.variants?.[i]?.price?.message} hint="Optional">{(p) => <NairaInput {...p} {...register(`variants.${i}.price`)} />}</Field>
                <Field label="Discount" error={errors.variants?.[i]?.discountPrice?.message}>{(p) => <NairaInput {...p} {...register(`variants.${i}.discountPrice`)} />}</Field>
                <Field label="Status">
                  {(p) => <Select {...p} {...register(`variants.${i}.status`)}>{CATALOG_STATUSES.map((s) => <option key={s} value={s}>{s === 'active' ? 'Active' : 'Inactive'}</option>)}</Select>}
                </Field>
                <Button size="icon" variant="ghost" aria-label="Remove variant" onClick={() => variants.remove(i)} className="justify-self-end"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => variants.append({ sku: '', size: '', color: '', price: '', discountPrice: '', status: 'active' })}><Plus className="h-4 w-4" /> Add variant</Button>
            <p className="text-xs text-ink-muted">A variant that still has stock cannot be removed. Set it to inactive instead.</p>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Specifications" description="Shown as a table on the product page." />
        <CardBody className="space-y-2">
          {specs.fields.map((f, i) => (
            <div key={f.id} className="flex gap-2">
              <Input aria-label="Specification name" placeholder="Screen size" {...register(`specifications.${i}.label`)} className="w-1/3" />
              <Input aria-label="Specification value" placeholder='55"' {...register(`specifications.${i}.value`)} />
              <Button size="icon" variant="ghost" aria-label="Remove specification" onClick={() => specs.remove(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => specs.append({ label: '', value: '' })}><Plus className="h-4 w-4" /> Add specification</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Visibility" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" hint="Only active products appear on the website.">
            {(p) => (
              <Select {...p} {...register('status')}>
                <option value="draft">Draft (hidden)</option>
                <option value="active">Active (on sale)</option>
                <option value="inactive">Inactive (withdrawn)</option>
              </Select>
            )}
          </Field>
          <Controller control={control} name="isFeatured" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="Featured" description="Shown on the home page." />} />
        </CardBody>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <Button type="submit" loading={isSubmitting} disabled={Boolean(product) && !isDirty}>{submitLabel}</Button>
      </div>
    </form>
  );
}
