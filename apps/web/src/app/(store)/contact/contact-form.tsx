'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { publicEnquirySchema } from '@mb/shared';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

type In = z.input<typeof publicEnquirySchema>;
type Out = z.output<typeof publicEnquirySchema>;

export function ContactForm({ branches }: { branches: { id: string; name: string }[] }) {
  const [sent, setSent] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(publicEnquirySchema),
    defaultValues: { branch: branches.length === 1 ? branches[0]!.id : '', name: '', phone: '', email: undefined, subject: '', message: '', website: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (sent) {
    return (
      <div className="rounded-xl border border-success-700/20 bg-success-50 p-6">
        <CheckCircle2 className="h-8 w-8 text-success-700" aria-hidden />
        <h2 className="mt-3 text-lg font-semibold">Thank you, we have your message</h2>
        <p className="mt-1 text-sm text-ink-muted">Your reference is <strong className="text-ink">{sent}</strong>. The branch will contact you on the number you gave.</p>
        <Button variant="secondary" className="mt-4" onClick={() => { form.reset(); setSent(null); }}>Send another message</Button>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<{ reference: string }>('/enquiries', values);
      setSent(res.reference);
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['branch', 'name', 'phone', 'email', 'subject', 'message']));
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {formError && <Alert className="sm:col-span-2">{formError}</Alert>}
      <Field label="Which branch?" error={errors.branch?.message} required className="sm:col-span-2">
        {(p) => (
          <Select {...p} {...form.register('branch')}>
            <option value="">Choose a branch</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Your name" error={errors.name?.message} required>{(p) => <Input {...p} autoComplete="name" {...form.register('name')} />}</Field>
      <Field label="Phone number" error={errors.phone?.message} required>{(p) => <Input {...p} type="tel" autoComplete="tel" {...form.register('phone')} placeholder="0803 123 4567" />}</Field>
      <Field label="Email (optional)" error={errors.email?.message} className="sm:col-span-2">
        {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email', { setValueAs: (v: string) => (v?.trim() ? v : undefined) })} />}
      </Field>
      <Field label="Subject" error={errors.subject?.message} required className="sm:col-span-2">{(p) => <Input {...p} {...form.register('subject')} />}</Field>
      <Field label="Message" error={errors.message?.message} required className="sm:col-span-2">{(p) => <Textarea {...p} rows={5} {...form.register('message')} />}</Field>
      {/* Hidden from people; bots that fill every field are rejected. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" {...form.register('website')} /></label>
      </div>
      <div className="sm:col-span-2"><Button type="submit" size="lg" loading={isSubmitting}>Send message</Button></div>
    </form>
  );
}
