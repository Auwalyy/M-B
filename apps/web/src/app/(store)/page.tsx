import { type CategoryDto, type PublicBranchDto, type PublicProductDto, type PublicPromotionDto, type PublicSettingsDto, formatNaira } from '@mb/shared';
import { ArrowRight, MapPin, MessageCircle, ShieldCheck, Store, Tag, Truck } from 'lucide-react';
import Link from 'next/link';
import { BranchCard, whatsappLink } from '@/components/store/branch-card';
import { ProductGrid } from '@/components/store/product-card';
import { ButtonLink, buttonClasses } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { serverGet, serverPage } from '@/lib/server-api';
import { imageUrl } from '@/lib/utils';

export const revalidate = 300;

function promoText(p: PublicPromotionDto) {
  if (p.type === 'percentage') return `${p.value}% off`;
  if (p.type === 'fixed_amount') return `${formatNaira(p.value)} off`;
  return 'Free delivery';
}

export default async function HomePage() {
  const [settings, branches, featured, latest, categories, promotions] = await Promise.all([
    serverGet<PublicSettingsDto>('/settings'),
    serverGet<PublicBranchDto[]>('/branches'),
    serverPage<PublicProductDto>('/products?featured=true&limit=8', 300),
    serverPage<PublicProductDto>('/products?sort=newest&limit=8', 300),
    serverGet<CategoryDto[]>('/categories'),
    serverGet<PublicPromotionDto[]>('/promotions/active', 300),
  ]);
  const companyName = settings?.companyName ?? 'Mudassir & Brothers';
  const states = new Set((branches ?? []).map((b) => (b.state === 'FCT' ? 'Abuja' : b.state)));
  const topCategories = (categories ?? []).filter((c) => !c.parent).slice(0, 6);
  const latestOnly = (latest?.data ?? []).filter((p) => !(featured?.data ?? []).some((f) => f.id === p.id));

  return (
    <>
      <section className="relative overflow-hidden bg-brand-800 text-white">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(226,189,106,0.22),transparent_55%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-widest text-accent-300 uppercase">
              {branches?.length ? `${branches.length} branches · ${[...states].join(' & ')}` : 'Kano & Abuja'}
            </p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">Genuine electronics and appliances, near you.</h1>
            <p className="mt-5 max-w-xl text-lg text-brand-100">
              {settings?.tagline ?? 'Quality products across Kano and Abuja.'} Shop online, then pick up at your branch or have it delivered.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/shop" variant="accent" size="lg">Shop now <ArrowRight className="h-5 w-5" aria-hidden /></ButtonLink>
              {settings?.whatsapp && (
                <a href={whatsappLink(settings.whatsapp, `Hello ${companyName}, I have an enquiry.`)} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'lg', 'border-white/30 bg-white/10 text-white hover:border-white/50 hover:bg-white/20')}>
                  <MessageCircle className="h-5 w-5" aria-hidden /> Chat on WhatsApp
                </a>
              )}
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              { icon: Store, title: 'Pick up in branch', text: 'Order online and collect at a time that suits you.' },
              { icon: Truck, title: 'Home delivery', text: 'Delivered by your nearest branch.' },
              { icon: ShieldCheck, title: 'Genuine products', text: 'Sourced carefully and backed by warranty.' },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <Icon className="h-5 w-5 shrink-0 text-accent-300" aria-hidden />
                <div><p className="font-semibold">{title}</p><p className="text-sm text-brand-200">{text}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {promotions && promotions.length > 0 && (
        <section aria-label="Current offers" className="border-b border-accent-100 bg-accent-50">
          <ul className="mx-auto flex max-w-6xl flex-wrap gap-x-8 gap-y-2 px-4 py-3 text-sm">
            {promotions.slice(0, 3).map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-accent-700">
                <Tag className="h-4 w-4" aria-hidden />
                <strong>{promoText(p)}</strong> {p.name}
                {p.code && <span>· use code <code className="rounded bg-white px-1.5 py-0.5 font-bold">{p.code}</code></span>}
                {p.minOrderAmount && <span className="text-accent-600">on orders over {formatNaira(p.minOrderAmount)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {topCategories.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-12" aria-labelledby="cat-h">
          <h2 id="cat-h" className="text-2xl font-bold tracking-tight">Shop by category</h2>
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {topCategories.map((c) => (
              <li key={c.id}>
                <Link href={`/categories/${c.slug}`} className="flex h-full flex-col items-center gap-2 rounded-xl border border-line bg-surface p-4 text-center hover:border-brand-300 hover:shadow-card">
                  {c.image ? <img src={imageUrl(c.image.url, 160)!} alt="" className="h-16 w-16 object-contain" loading="lazy" /> : <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-xl font-bold text-brand-700" aria-hidden>{c.name[0]}</span>}
                  <span className="text-sm font-semibold">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {featured && featured.data.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-12" aria-labelledby="feat-h">
          <div className="mb-5 flex items-end justify-between gap-3">
            <h2 id="feat-h" className="text-2xl font-bold tracking-tight">Featured</h2>
            <Link href="/shop" className="text-sm font-semibold text-brand-700 hover:underline">See all products</Link>
          </div>
          <ProductGrid products={featured.data} eager={4} />
        </section>
      )}

      {latestOnly.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-12" aria-labelledby="new-h">
          <h2 id="new-h" className="mb-5 text-2xl font-bold tracking-tight">New arrivals</h2>
          <ProductGrid products={latestOnly.slice(0, 4)} />
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="branches-heading">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="branches-heading" className="text-2xl font-bold tracking-tight">Visit a branch</h2>
            <p className="mt-1 text-ink-muted">Opening hours, directions and direct WhatsApp lines.</p>
          </div>
          <ButtonLink href="/branches" variant="secondary"><MapPin className="h-4 w-4" /> All branches</ButtonLink>
        </div>
        {branches === null ? (
          <Alert kind="warning" title="Branch information is temporarily unavailable">Please try again in a few minutes.</Alert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {branches.slice(0, 6).map((b) => <BranchCard key={b.id} branch={b} companyName={companyName} />)}
          </div>
        )}
      </section>
    </>
  );
}
