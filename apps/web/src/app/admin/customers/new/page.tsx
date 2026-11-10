'use client';

import { type CustomerDto, type CustomerLookupDto, NIGERIAN_STATES, createCustomerSchema, formatPhone, normalizePhone } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function NewCustomer() {
  const params = useSearchParams();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [phone, setPhone] = useState(params.get('phone') ?? '');
  const [checked, setChecked] = useState<{ phone: string; match: CustomerLookupDto | null } | null>(null);
  const [branch, setBranch] = useState(user?.scope === 'branch' ? user.branches[0]?.id ?? '' : '');
  const [f, setF] = useState({ fullName: params.get('name') ?? '', email: '', source: 'walk_in', tags: '', notes: '', line1: '', area: '', city: '', state: 'Kano' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    setFormError(null);
    const normalized = normalizePhone(phone);
    if (!normalized) return setErrors({ phone: 'Enter a valid phone number, e.g. 0803 123 4567' });
    setErrors({});
    setBusy(true);
    try {
      setChecked({ phone: normalized, match: await api.get<CustomerLookupDto | null>('/customers/lookup', { phone: normalized }) });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const link = async (id: string) => {
    if (!branch) return setFormError('Choose your branch first.');
    setBusy(true);
    try {
      await api.post(`/customers/${id}/branches`, { branch });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer added to your branch');
      router.push(`/admin/customers/${id}`);
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  };

  const create = async () => {
    setFormError(null);
    const body = {
      fullName: f.fullName,
      phone: checked!.phone,
      email: f.email.trim() || undefined,
      branch,
      source: f.source,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: f.notes || undefined,
      address: f.line1.trim() ? { line1: f.line1, area: f.area || undefined, city: f.city, state: f.state } : undefined,
    };
    const parsed = createCustomerSchema.safeParse(body);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[i.path.join('.')] ??= i.message;
      setErrors(e);
      return;
    }
    setBusy(true);
    try {
      const c = await api.post<CustomerDto>('/customers', body);
      await qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`${c.fullName} registered`);
      router.push(`/admin/customers/${c.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CUSTOMER_EXISTS') return void lookup();
      setFormError(errorMessage(err));
      setBusy(false);
    }
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Register a customer"
        description="Start with the phone number. If the customer already shops at another branch, you will serve the same record."
        back={<Link href="/admin/customers" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Customers</Link>}
      />
      <div className="space-y-6">
        {formError && <Alert>{formError}</Alert>}
        <Card>
          <CardBody className="flex flex-wrap items-end gap-3">
            <Field label="Phone number" error={errors.phone} className="min-w-56 flex-1" required>
              {(p) => <Input {...p} type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setChecked(null); }} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="0803 123 4567" autoFocus />}
            </Field>
            <Field label="Your branch" required>{() => <BranchSelect value={branch} onChange={setBranch} />}</Field>
            <Button onClick={lookup} loading={busy && !checked} variant={checked ? 'secondary' : 'primary'}><Search className="h-4 w-4" /> Check</Button>
          </CardBody>
        </Card>

        {checked?.match && (
          <Alert
            kind="info"
            title={`${checked.match.fullName} is already a customer`}
            action={
              checked.match.inScope ? (
                <ButtonLink href={`/admin/customers/${checked.match.id}`} size="sm">Open profile</ButtonLink>
              ) : (
                <Button size="sm" loading={busy} onClick={() => link(checked.match!.id)}><UserCheck className="h-4 w-4" /> Serve at my branch</Button>
              )
            }
          >
            {formatPhone(checked.match.phone)}
            {checked.match.inScope ? ' · already served by your branch.' : ' · registered at another branch. Add them to your branch to see their profile.'}
          </Alert>
        )}

        {checked && !checked.match && (
          <Card>
            <CardHeader title="New customer" description={`No customer uses ${formatPhone(checked.phone)} yet.`} />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" error={errors.fullName} required className="sm:col-span-2">{(p) => <Input {...p} value={f.fullName} onChange={set('fullName')} />}</Field>
              <Field label="Email" error={errors.email}>{(p) => <Input {...p} type="email" value={f.email} onChange={set('email')} />}</Field>
              <Field label="How did they reach us?">
                {(p) => (
                  <Select {...p} value={f.source} onChange={set('source')}>
                    <option value="walk_in">Walked into the branch</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="phone">Phone call</option>
                  </Select>
                )}
              </Field>
              <Field label="Address" error={errors['address.line1']} className="sm:col-span-2">{(p) => <Input {...p} value={f.line1} onChange={set('line1')} placeholder="Optional" />}</Field>
              {f.line1.trim() && (
                <>
                  <Field label="Area">{(p) => <Input {...p} value={f.area} onChange={set('area')} />}</Field>
                  <Field label="City" error={errors['address.city']} required>{(p) => <Input {...p} value={f.city} onChange={set('city')} />}</Field>
                  <Field label="State">
                    {(p) => <Select {...p} value={f.state} onChange={set('state')}>{NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>}
                  </Field>
                </>
              )}
              <Field label="Tags" hint="Comma separated, e.g. wholesale, vip" error={errors.tags} className="sm:col-span-2">{(p) => <Input {...p} value={f.tags} onChange={set('tags')} />}</Field>
              <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.notes} onChange={set('notes')} />}</Field>
              <div className="flex justify-end sm:col-span-2"><Button loading={busy} onClick={create}>Register customer</Button></div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function NewCustomerPage() {
  return (
    <Suspense>
      <NewCustomer />
    </Suspense>
  );
}
