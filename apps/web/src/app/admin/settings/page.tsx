'use client';

import { PERMISSIONS, type SettingsDto, formatPhone, updateSettingsSchema } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, Switch, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys, useSettings } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

interface FormValues {
  companyName: string;
  tagline: string;
  supportEmail: string;
  supportPhone: string;
  whatsapp: string;
  address: string;
  lowStockDefault: string;
  adjustmentApprovalThreshold: string;
  pendingExpiryHours: string;
  confirmedHoldHours: string;
  maxQuantityPerItem: string;
  guestCheckoutEnabled: boolean;
  pricesIncludeVat: boolean;
  showVatOnReceipts: boolean;
  vatRatePercent: string;
  receiptFooter: string;
}

const toForm = (s: SettingsDto): FormValues => ({
  companyName: s.companyName,
  tagline: s.tagline ?? '',
  supportEmail: s.supportEmail,
  supportPhone: formatPhone(s.supportPhone),
  whatsapp: formatPhone(s.whatsapp),
  address: s.address ?? '',
  lowStockDefault: String(s.lowStockDefault),
  adjustmentApprovalThreshold: String(s.adjustmentApprovalThreshold),
  pendingExpiryHours: String(s.reservation.pendingExpiryHours),
  confirmedHoldHours: String(s.reservation.confirmedHoldHours),
  maxQuantityPerItem: String(s.reservation.maxQuantityPerItem),
  guestCheckoutEnabled: s.guestCheckoutEnabled,
  pricesIncludeVat: s.pricesIncludeVat,
  showVatOnReceipts: s.showVatOnReceipts,
  vatRatePercent: String(s.vatRatePercent),
  receiptFooter: s.receiptFooter ?? '',
});

const toPayload = (v: FormValues) => ({
  companyName: v.companyName,
  tagline: v.tagline,
  supportEmail: v.supportEmail,
  supportPhone: v.supportPhone,
  whatsapp: v.whatsapp,
  address: v.address,
  lowStockDefault: Number(v.lowStockDefault),
  adjustmentApprovalThreshold: Number(v.adjustmentApprovalThreshold),
  reservation: {
    pendingExpiryHours: Number(v.pendingExpiryHours),
    confirmedHoldHours: Number(v.confirmedHoldHours),
    maxQuantityPerItem: Number(v.maxQuantityPerItem),
  },
  guestCheckoutEnabled: v.guestCheckoutEnabled,
  pricesIncludeVat: v.pricesIncludeVat,
  showVatOnReceipts: v.showVatOnReceipts,
  vatRatePercent: Number(v.vatRatePercent),
  receiptFooter: v.receiptFooter,
});

const fieldFor = (path: string): keyof FormValues | null => {
  const last = path.split('.').pop() as keyof FormValues;
  return last ?? null;
};

function SettingsForm({ settings, readOnly }: { settings: SettingsDto; readOnly: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues: toForm(settings) });
  const { register, control, formState, setError } = form;
  const { errors, isSubmitting, isDirty } = formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const payload = toPayload(values);
    const parsed = updateSettingsSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const f = fieldFor(issue.path.join('.'));
        if (f) setError(f, { message: issue.message });
      }
      return;
    }
    try {
      const updated = await api.patch<SettingsDto>('/settings', payload);
      qc.setQueryData(keys.settings, updated);
      form.reset(toForm(updated));
      toast.success('Settings saved');
    } catch (err) {
      if (err instanceof ApiError) for (const [p, m] of Object.entries(err.fieldErrors)) { const f = fieldFor(p); if (f) setError(f, { message: m[0] }); }
      setFormError(errorMessage(err));
    }
  });

  const text = (name: keyof FormValues, label: string, opts: { type?: string; hint?: string; className?: string; suffix?: string } = {}) => (
    <Field label={label} error={errors[name]?.message} hint={opts.hint} className={opts.className}>
      {(p) => <Input {...p} type={opts.type ?? 'text'} disabled={readOnly} {...register(name)} />}
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {formError && <Alert>{formError}</Alert>}
      {readOnly && <Alert kind="info">You can view these settings. Only the Super Admin can change them.</Alert>}

      <Card>
        <CardHeader title="Company" description="Shown on the website, emails and receipts." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {text('companyName', 'Company name')}
          {text('tagline', 'Tagline')}
          {text('supportPhone', 'Customer service phone', { type: 'tel' })}
          {text('whatsapp', 'Main WhatsApp number', { type: 'tel', hint: 'Used when a customer has not chosen a branch.' })}
          {text('supportEmail', 'Customer service email', { type: 'email' })}
          {text('address', 'Head office address')}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Reservations" description="Reserved stock is held for the customer for these periods." />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          {text('pendingExpiryHours', 'Unconfirmed reservations expire after (hours)', { type: 'number' })}
          {text('confirmedHoldHours', 'Confirmed reservations held for (hours)', { type: 'number', hint: 'Branches can set their own.' })}
          {text('maxQuantityPerItem', 'Maximum quantity per item', { type: 'number' })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Checkout, stock and tax" />
        <CardBody className="space-y-2">
          <Controller control={control} name="guestCheckoutEnabled" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} disabled={readOnly} label="Allow guest checkout" description="Customers can order without creating an account." />} />
          <Controller control={control} name="pricesIncludeVat" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} disabled={readOnly} label="Prices include VAT" />} />
          <Controller control={control} name="showVatOnReceipts" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} disabled={readOnly} label="Show VAT on receipts" />} />
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            {text('vatRatePercent', 'VAT rate (%)', { type: 'number' })}
            {text('lowStockDefault', 'Default low-stock level', { type: 'number', hint: 'Units at or below which a product is flagged as low stock.' })}
            {text('adjustmentApprovalThreshold', 'Stock corrections needing approval', { type: 'number', hint: 'Corrections larger than this many units per product need a second person to approve.' })}
          </div>
          <Field label="Receipt footer" error={errors.receiptFooter?.message}>
            {(p) => <Textarea {...p} disabled={readOnly} {...register('receiptFooter')} />}
          </Field>
        </CardBody>
      </Card>

      {!readOnly && (
        <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <span className="text-xs text-ink-muted">Last updated {formatDateTime(settings.updatedAt)}</span>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save settings</Button>
        </div>
      )}
    </form>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const canEdit = useCan(PERMISSIONS.SETTINGS_UPDATE);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Company settings" description="Defaults that apply to every branch." />
      {settings.isLoading && <Skeleton className="h-96" />}
      {settings.error && <Alert>{errorMessage(settings.error)}</Alert>}
      {settings.data && 'reservation' in settings.data && <SettingsForm key={settings.data.updatedAt} settings={settings.data} readOnly={!canEdit} />}
    </div>
  );
}
