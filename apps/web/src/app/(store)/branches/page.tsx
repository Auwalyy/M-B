import type { PublicBranchDto, PublicSettingsDto } from '@mb/shared';
import { Building2 } from 'lucide-react';
import type { Metadata } from 'next';
import { BranchCard } from '@/components/store/branch-card';
import { Alert, EmptyState } from '@/components/ui/display';
import { serverGet } from '@/lib/server-api';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Branches',
  description: 'Find a Mudassir & Brothers branch in Kano or Abuja: addresses, opening hours, phone and WhatsApp contacts.',
};

export default async function BranchesPage() {
  const [branches, settings] = await Promise.all([
    serverGet<PublicBranchDto[]>('/branches'),
    serverGet<PublicSettingsDto>('/settings'),
  ]);

  const groups = new Map<string, PublicBranchDto[]>();
  for (const b of branches ?? []) {
    const key = b.state === 'FCT' ? 'Abuja (FCT)' : b.state;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }

  // Structured data so search engines can show branch details.
  const jsonLd = (branches ?? []).map((b) => ({
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: `${settings?.companyName ?? 'Mudassir & Brothers'} – ${b.name}`,
    telephone: b.phone,
    address: { '@type': 'PostalAddress', streetAddress: b.address, addressLocality: b.city, addressRegion: b.state, addressCountry: 'NG' },
    ...(b.coordinates ? { geo: { '@type': 'GeoCoordinates', latitude: b.coordinates.lat, longitude: b.coordinates.lng } } : {}),
    openingHoursSpecification: b.openingHours
      .filter((h) => !h.closed)
      .map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][h.day], opens: h.open, closes: h.close })),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <h1 className="text-3xl font-bold tracking-tight">Our branches</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Visit us in person, call, or send a WhatsApp message straight to the branch. Times shown are Nigeria time (WAT).
      </p>

      {branches === null && (
        <Alert kind="warning" className="mt-8" title="Branch information is temporarily unavailable">Please try again in a few minutes.</Alert>
      )}
      {branches?.length === 0 && <EmptyState icon={Building2} title="No branches listed yet" description="Please check back soon." />}

      {[...groups.entries()].map(([state, list]) => (
        <section key={state} className="mt-10" aria-labelledby={`state-${state}`}>
          <h2 id={`state-${state}`} className="mb-4 text-lg font-semibold text-ink">
            {state} <span className="font-normal text-ink-faint">· {list.length} branch{list.length === 1 ? '' : 'es'}</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((b) => (
              <BranchCard key={b.id} branch={b} companyName={settings?.companyName} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
