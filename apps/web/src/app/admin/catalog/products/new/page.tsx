'use client';

import { PERMISSIONS, type ProductDto } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProductForm } from '@/components/admin/product-form';
import { ButtonLink } from '@/components/ui/button';
import { Alert, PageHeader } from '@/components/ui/display';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useCategories } from '@/lib/queries';

export default function NewProductPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan(PERMISSIONS.PRODUCTS_WRITE);
  const showCost = useCan(PERMISSIONS.INVENTORY_READ_COST);
  const categories = useCategories();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Add product"
        description="Save first, then add photos and receive stock at each branch."
        back={<Link href="/admin/catalog/products" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Products</Link>}
      />
      {!canWrite ? (
        <Alert kind="warning">Only head office can add products.</Alert>
      ) : categories.data?.length === 0 ? (
        <Alert kind="info" title="Create a category first" action={<ButtonLink href="/admin/catalog/categories" size="sm" variant="secondary">Categories</ButtonLink>}>
          Every product belongs to a category.
        </Alert>
      ) : (
        <ProductForm
          showCost={showCost}
          submitLabel="Create product"
          onSubmit={async (payload) => {
            const p = await api.post<ProductDto>('/products', payload);
            await qc.invalidateQueries({ queryKey: ['products'] });
            toast.success(`${p.name} created. Add photos next.`);
            router.push(`/admin/catalog/products/${p.id}?tab=photos`);
          }}
        />
      )}
    </div>
  );
}
