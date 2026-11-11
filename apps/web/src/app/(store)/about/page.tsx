import type { PublicBranchDto, PublicSettingsDto } from '@mb/shared';
import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/button';
import { serverGet } from '@/lib/server-api';

export const revalidate = 3600;
export const metadata: Metadata = {
  title: 'About us',
  description: 'Mudassir & Brothers is a family retail business serving customers from branches in Kano and Abuja.',
};

export default async function AboutPage() {
  const [settings, branches] = await Promise.all([serverGet<PublicSettingsDto>('/settings'), serverGet<PublicBranchDto[]>('/branches')]);
  const name = settings?.companyName ?? 'Mudassir & Brothers';
  const cities = [...new Set((branches ?? []).map((b) => b.city))];
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">About {name}</h1>
      <div className="mt-6 space-y-4 text-lg leading-relaxed text-ink-muted">
        <p>{name} is a family retail business{cities.length ? ` with ${branches!.length} branches in ${cities.join(' and ')}` : ''}. We sell genuine electronics, home appliances and everyday essentials, and we stand behind everything we sell.</p>
        <p>Shop in person at any branch, or order online and choose to collect from the branch nearest to you or have it delivered. Our staff are a WhatsApp message away if you need advice before you buy.</p>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/shop">Browse products</ButtonLink>
        <ButtonLink href="/branches" variant="secondary">Find a branch</ButtonLink>
        <ButtonLink href="/contact" variant="ghost">Contact us</ButtonLink>
      </div>
    </div>
  );
}
