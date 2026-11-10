import type { PublicBranchDto, PublicSettingsDto } from '@mb/shared';
import { formatPhone } from '@mb/shared';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { whatsappLink } from '@/components/store/branch-card';
import { serverGet } from '@/lib/server-api';
import { ContactForm } from './contact-form';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Contact us',
  description: 'Send Mudassir & Brothers a question, or reach a branch directly by phone or WhatsApp.',
};

export default async function ContactPage() {
  const [branches, settings] = await Promise.all([serverGet<PublicBranchDto[]>('/branches'), serverGet<PublicSettingsDto>('/settings')]);
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1fr_22rem]">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Contact us</h1>
        <p className="mt-2 max-w-xl text-ink-muted">Ask about a product, price or delivery. The branch you choose will get back to you, usually the same day.</p>
        <div className="mt-8">
          {branches?.length ? <ContactForm branches={branches.map((b) => ({ id: b.id, name: b.name }))} /> : <p className="text-ink-muted">Our enquiry form is temporarily unavailable. Please call or WhatsApp us.</p>}
        </div>
      </div>
      {settings && (
        <aside className="space-y-3 lg:pt-16">
          <h2 className="font-semibold">Prefer to talk?</h2>
          <a href={whatsappLink(settings.whatsapp, `Hello ${settings.companyName}, I have an enquiry.`)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:border-brand-300">
            <MessageCircle className="h-5 w-5 text-brand-600" aria-hidden /> <span><span className="block text-sm font-semibold">WhatsApp</span><span className="text-sm text-ink-muted">{formatPhone(settings.whatsapp)}</span></span>
          </a>
          <a href={`tel:${settings.supportPhone}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:border-brand-300">
            <Phone className="h-5 w-5 text-brand-600" aria-hidden /> <span><span className="block text-sm font-semibold">Call</span><span className="text-sm text-ink-muted">{formatPhone(settings.supportPhone)}</span></span>
          </a>
          <a href={`mailto:${settings.supportEmail}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:border-brand-300">
            <Mail className="h-5 w-5 text-brand-600" aria-hidden /> <span><span className="block text-sm font-semibold">Email</span><span className="text-sm text-ink-muted">{settings.supportEmail}</span></span>
          </a>
        </aside>
      )}
    </div>
  );
}
