'use client';

import {
  BRANCH_PROFILE_FIELDS,
  type BranchDto,
  NIGERIAN_STATES,
  WEEKDAYS,
  createBranchSchema,
  formatPhone,
  updateBranchSchema,
} from '@mb/shared';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Controller, type FieldPath, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/display';
import { Field, Input, Select, Switch } from '@/components/ui/field';
import { ApiError, errorMessage } from '@/lib/api';

interface HoursRow { day: number; open: string; close: string; closed: boolean }

export interface BranchFormValues {
  name: string;
  code: string;
  address: string;
  area: string;
  landmark: string;
  city: string;
  state: string;
  phone: string;
  whatsapp: string;
  email: string;
  lat: string;
  lng: string;
  openingHours: HoursRow[];
  reservationsEnabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  reservationHoldHours: string;
}

/** Monday first, the way staff read a week. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function initialValues(b?: BranchDto): BranchFormValues {
  const hours = DAY_ORDER.map((day) => {
    const h = b?.openingHours.find((x) => x.day === day);
    return h ?? { day, open: '08:00', close: '18:00', closed: day === 0 };
  });
  return {
    name: b?.name ?? '',
    code: b?.code ?? '',
    address: b?.address ?? '',
    area: b?.area ?? '',
    landmark: b?.landmark ?? '',
    city: b?.city ?? '',
    state: b?.state ?? 'Kano',
    phone: b?.phone ? formatPhone(b.phone) : '',
    whatsapp: b?.whatsapp ? formatPhone(b.whatsapp) : '',
    email: b?.email ?? '',
    lat: b?.coordinates ? String(b.coordinates.lat) : '',
    lng: b?.coordinates ? String(b.coordinates.lng) : '',
    openingHours: hours,
    reservationsEnabled: b?.settings.reservationsEnabled ?? true,
    pickupEnabled: b?.settings.pickupEnabled ?? true,
    deliveryEnabled: b?.settings.deliveryEnabled ?? true,
    reservationHoldHours: b?.settings.reservationHoldHours ? String(b.settings.reservationHoldHours) : '',
  };
}

function toPayload(v: BranchFormValues) {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    name: v.name,
    code: v.code,
    address: v.address,
    area: opt(v.area),
    landmark: opt(v.landmark),
    city: v.city,
    state: v.state,
    phone: v.phone,
    whatsapp: v.whatsapp,
    email: opt(v.email),
    coordinates: v.lat.trim() || v.lng.trim() ? { lat: Number(v.lat), lng: Number(v.lng) } : undefined,
    openingHours: v.openingHours,
    settings: {
      reservationsEnabled: v.reservationsEnabled,
      pickupEnabled: v.pickupEnabled,
      deliveryEnabled: v.deliveryEnabled,
      reservationHoldHours: v.reservationHoldHours.trim() ? Number(v.reservationHoldHours) : null,
    },
  };
}

/** Maps a validation path from the API/shared schema onto this form's fields. */
function formPath(path: string): FieldPath<BranchFormValues> | null {
  if (path.startsWith('coordinates')) return path.endsWith('lng') ? 'lng' : 'lat';
  const hours = /^openingHours\.(\d+)\.(open|close)$/.exec(path);
  if (hours) return `openingHours.${Number(hours[1])}.${hours[2] as 'open' | 'close'}`;
  if (path.startsWith('settings.')) return path.slice(9) as FieldPath<BranchFormValues>;
  return (['name', 'code', 'address', 'area', 'landmark', 'city', 'state', 'phone', 'whatsapp', 'email'] as const).find((f) => f === path) ?? null;
}

export function BranchForm({
  branch,
  profileOnly,
  submitLabel,
  onSubmit,
}: {
  branch?: BranchDto;
  /** Branch admins can edit only contact details, hours and services. */
  profileOnly?: boolean;
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<BranchFormValues>({ defaultValues: initialValues(branch) });
  const { register, control, formState, setError, handleSubmit, watch } = form;
  const { errors, isSubmitting, isDirty } = formState;
  const locked = (field: string) => Boolean(profileOnly && !(BRANCH_PROFILE_FIELDS as readonly string[]).includes(field));

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    let payload: Record<string, unknown> = toPayload(values);
    if (profileOnly) {
      payload = Object.fromEntries(Object.entries(payload).filter(([k]) => (BRANCH_PROFILE_FIELDS as readonly string[]).includes(k)));
    }
    const schema = branch ? updateBranchSchema : createBranchSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      let placed = false;
      for (const issue of parsed.error.issues) {
        const p = formPath(issue.path.join('.'));
        if (p) {
          setError(p, { message: issue.message });
          placed = true;
        }
      }
      if (!placed) setFormError(parsed.error.issues[0]?.message ?? 'Check the highlighted fields.');
      return;
    }
    try {
      await onSubmit(payload);
      form.reset(values);
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [path, msgs] of Object.entries(err.fieldErrors)) {
          const p = formPath(path);
          if (p) setError(p, { message: msgs[0] });
        }
        if (err.status === 409 && err.code === 'DUPLICATE') setError('code', { message: 'Another branch already uses this code' });
      }
      setFormError(errorMessage(err));
    }
  });

  const text = (name: keyof BranchFormValues, label: string, opts: { required?: boolean; hint?: string; placeholder?: string; type?: string; className?: string } = {}) => (
    <Field label={label} error={errors[name]?.message as string | undefined} hint={locked(name) ? 'Only the Super Admin can change this.' : opts.hint} required={opts.required} className={opts.className}>
      {(p) => <Input {...p} type={opts.type ?? 'text'} placeholder={opts.placeholder} disabled={locked(name)} {...register(name)} />}
    </Field>
  );

  const hours = watch('openingHours');

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {formError && <Alert kind="error">{formError}</Alert>}
      {profileOnly && (
        <Alert kind="info" title="Some details are managed by head office">
          You can update contact numbers, opening hours and services. Ask the Super Admin to change the name, code or address.
        </Alert>
      )}

      <Card>
        <CardHeader title="Branch details" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {text('name', 'Branch name', { required: true, placeholder: 'Kano – Zoo Road', className: 'sm:col-span-2' })}
          {text('code', 'Branch code', { required: true, placeholder: 'KAN01', hint: '3 letters and 2 digits. Used on order and receipt numbers.' })}
          <Field label="State" error={errors.state?.message} required>
            {(p) => (
              <Select {...p} disabled={locked('state')} {...register('state')}>
                {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s === 'FCT' ? 'FCT (Abuja)' : s}</option>)}
              </Select>
            )}
          </Field>
          {text('address', 'Street address', { required: true, className: 'sm:col-span-2' })}
          {text('area', 'Area / neighbourhood', { placeholder: 'Sabon Gari' })}
          {text('city', 'City', { required: true })}
          {text('landmark', 'Landmark', { placeholder: 'Opposite the main market', className: 'sm:col-span-2' })}
          {text('lat', 'Latitude', { placeholder: '12.0022', hint: 'Optional. Used for map directions.' })}
          {text('lng', 'Longitude', { placeholder: '8.5920' })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contact" description="Shown to customers on the website. WhatsApp enquiries go to this number." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {text('phone', 'Phone number', { required: true, type: 'tel', placeholder: '0803 123 4567' })}
          {text('whatsapp', 'WhatsApp number', { required: true, type: 'tel', placeholder: '0803 123 4567' })}
          {text('email', 'Email address', { type: 'email', className: 'sm:col-span-2' })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Opening hours" description="Nigeria time (WAT)." />
        <CardBody className="p-0">
          <ul className="divide-y divide-line">
            {hours.map((h, i) => (
              <li key={h.day} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 px-5 py-2.5 sm:grid-cols-[8rem_7rem_1fr]">
                <span className="text-sm font-medium text-ink">{WEEKDAYS[h.day]}</span>
                <Controller
                  control={control}
                  name={`openingHours.${i}.closed`}
                  render={({ field }) => (
                    <label className="flex items-center gap-2 text-sm text-ink-muted">
                      <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={!field.value} onChange={(e) => field.onChange(!e.target.checked)} />
                      Open
                    </label>
                  )}
                />
                <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                  {h.closed ? (
                    <span className="text-sm text-ink-faint">Closed all day</span>
                  ) : (
                    <>
                      <Input type="time" aria-label={`${WEEKDAYS[h.day]} opening time`} className="h-9 w-32" {...register(`openingHours.${i}.open`)} />
                      <span className="text-ink-faint">to</span>
                      <Input type="time" aria-label={`${WEEKDAYS[h.day]} closing time`} aria-invalid={Boolean(errors.openingHours?.[i]?.close)} className="h-9 w-32" {...register(`openingHours.${i}.close`)} />
                      {errors.openingHours?.[i]?.close && <span role="alert" className="text-xs text-danger-700">{errors.openingHours[i]?.close?.message}</span>}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Services" description="What customers can do with this branch." />
        <CardBody className="divide-y divide-line py-1">
          <Controller control={control} name="pickupEnabled" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="Branch pickup" description="Customers can collect online orders here." />} />
          <Controller control={control} name="deliveryEnabled" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="Home delivery" description="This branch fulfils delivery orders." />} />
          <Controller control={control} name="reservationsEnabled" render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="Reservations" description="Customers can reserve products at this branch." />} />
          <div className="pt-3 pb-2">
            {text('reservationHoldHours', 'Reservation hold time (hours)', { type: 'number', hint: 'Leave empty to use the company default.' })}
          </div>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        {profileOnly && <span className="mr-auto flex items-center gap-1.5 text-xs text-ink-muted"><Lock className="h-3.5 w-3.5" /> Some fields are locked</span>}
        <Button type="submit" loading={isSubmitting} disabled={Boolean(branch) && !isDirty}>{submitLabel}</Button>
      </div>
    </form>
  );
}
