import type { PublicBranchDto, PublicSettingsDto } from '@mb/shared';
import { MapPin, MessageCircle, ShieldCheck, Store, Truck } from 'lucide-react';
import { BranchCard, whatsappLink } from '@/components/store/branch-card';
import { ButtonLink, buttonClasses } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { serverGet } from '@/lib/server-api';

export const revalidate = 300;

export default async function HomePage() {
  const [settings, branches] = await Promise.all([
    serverGet<PublicSettingsDto>('/settings'),
    serverGet<PublicBranchDto[]>('/branches'),
  ]);
  const companyName = settings?.companyName ?? 'Mudassir & Brothers';
  const states = new Set((branches ?? []).map((b) => (b.state === 'FCT' ? 'Abuja' : b.state)));

  return (
    <>
      <section className="relative overflow-hidden bg-brand-800 text-white">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(226,189,106,0.22),transparent_55%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-24 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-widest text-accent-300 uppercase">
              {branches?.length ? `${branches.length} branches · ${[...states].join(' & ')}` : 'Kano & Abuja'}
            </p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
              Quality you can trust, at a branch near you.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-brand-100">
              {settings?.tagline ?? 'Quality products across Kano and Abuja.'} Visit any of our branches or chat with us on WhatsApp.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/branches" variant="accent" size="lg">
                <MapPin className="h-5 w-5" aria-hidden /> Find a branch
              </ButtonLink>
              {settings?.whatsapp && (
                <a
                  href={whatsappLink(settings.whatsapp, `Hello ${companyName}, I have an enquiry.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses('secondary', 'lg', 'border-white/30 bg-white/10 text-white hover:bg-white/20 hover:border-white/50')}
                >
                  <MessageCircle className="h-5 w-5" aria-hidden /> Chat on WhatsApp
                </a>
              )}
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              { icon: Store, title: 'Shop in branch', text: 'Friendly staff in every branch to help you choose.' },
              { icon: Truck, title: 'Pickup or delivery', text: 'Collect from your preferred branch or have it delivered.' },
              { icon: ShieldCheck, title: 'Genuine products', text: 'Sourced carefully and backed by our name.' },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <Icon className="h-5 w-5 shrink-0 text-accent-300" aria-hidden />
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-brand-200">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="branches-heading">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="branches-heading" className="text-2xl font-bold tracking-tight">Our branches</h2>
            <p className="mt-1 text-ink-muted">Opening hours, directions and direct WhatsApp lines for every branch.</p>
          </div>
          <ButtonLink href="/branches" variant="secondary">View all branches</ButtonLink>
        </div>
        {branches === null ? (
          <Alert kind="warning" title="Branch information is temporarily unavailable">Please try again in a few minutes.</Alert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {branches.slice(0, 6).map((b) => (
              <BranchCard key={b.id} branch={b} companyName={companyName} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
