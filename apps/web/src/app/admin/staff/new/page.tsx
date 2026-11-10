'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS, ROLE_LABELS, ROLE_RANK, STAFF_ROLE_KEYS, type StaffDto, createStaffSchema, formatPhone } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { TempPasswordInput } from '@/components/admin/temp-password';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { useBranches } from '@/lib/queries';
import { generatePassword } from '@/lib/utils';

type Input_ = z.input<typeof createStaffSchema>;
type Output = z.output<typeof createStaffSchema>;

export default function NewStaffPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const branches = useBranches({ status: 'active' });
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ staff: StaffDto; password: string } | null>(null);

  // A role can only create roles below its own (the Super Admin can create any).
  const roles = useMemo(
    () => STAFF_ROLE_KEYS.filter((r) => user?.role === 'SUPER_ADMIN' || ROLE_RANK[r] < ROLE_RANK[user?.role ?? 'CUSTOMER']),
    [user],
  );

  const form = useForm<Input_, unknown, Output>({
    resolver: zodResolver(createStaffSchema),
    defaultValues: {
      fullName: '',
      phone: '',
      email: undefined,
      role: roles.includes('BRANCH_ADMIN') ? 'BRANCH_ADMIN' : 'SALES_STAFF',
      branches: user?.scope === 'branch' && user.branches.length === 1 ? [user.branches[0]!.id] : [],
      temporaryPassword: generatePassword(),
    },
  });
  const { errors, isSubmitting } = form.formState;
  const role = form.watch('role');

  useEffect(() => {
    if (role === 'SUPER_ADMIN') form.setValue('branches', []);
  }, [role, form]);

  if (!user?.permissions.includes(PERMISSIONS.USERS_CREATE)) {
    return <Alert kind="warning">You do not have permission to add staff.</Alert>;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const staff = await api.post<StaffDto>('/users', values);
      await qc.invalidateQueries({ queryKey: ['staff'] });
      await qc.invalidateQueries({ queryKey: ['branches'] });
      setCreated({ staff, password: values.temporaryPassword });
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['fullName', 'phone', 'email', 'role', 'branches', 'temporaryPassword']));
    }
  });

  const back = <Link href="/admin/staff" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Staff</Link>;

  if (created) {
    const signIn = created.staff.email ?? (created.staff.phone ? formatPhone(created.staff.phone) : '');
    return (
      <div className="max-w-xl">
        <PageHeader title="Staff account created" back={back} />
        <Card>
          <CardBody className="space-y-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-success-700" aria-hidden />
              <p className="text-sm text-ink">
                <strong>{created.staff.fullName}</strong> can now sign in as <strong>{created.staff.roleName}</strong>
                {created.staff.branches.length > 0 && <> at {created.staff.branches.map((b) => b.name).join(', ')}</>}.
              </p>
            </div>
            <div className="rounded-lg border border-dashed border-line-strong bg-subtle p-4 font-mono text-sm">
              <p><span className="text-ink-muted">Sign in with:</span> {signIn}</p>
              <p className="mt-1"><span className="text-ink-muted">Temporary password:</span> <strong>{created.password}</strong></p>
            </div>
            <Alert kind="warning">
              Give these details to the staff member privately (in person or by phone). They must choose their own password the first time they sign in. This password will not be shown again.
            </Alert>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/admin/staff/${created.staff.id}`}>View staff member</ButtonLink>
              <Button
                variant="secondary"
                onClick={() => {
                  setCreated(null);
                  form.reset({ ...form.getValues(), fullName: '', phone: '', email: undefined, temporaryPassword: generatePassword() });
                }}
              >
                Add another
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Add staff" description="Create an account with a temporary password. The person chooses their own password the first time they sign in." back={back} />
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        {formError && <Alert kind="error">{formError}</Alert>}
        <Card>
          <CardHeader title="Person" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={errors.fullName?.message} required className="sm:col-span-2">
              {(p) => <Input {...p} autoComplete="off" {...form.register('fullName')} />}
            </Field>
            <Field label="Phone number" error={errors.phone?.message} required hint="Staff can sign in with their phone number.">
              {(p) => <Input {...p} type="tel" placeholder="0803 123 4567" {...form.register('phone')} />}
            </Field>
            <Field label="Email address" error={errors.email?.message} hint="Optional. Needed to reset a forgotten password by email.">
              {(p) => <Input {...p} type="email" {...form.register('email', { setValueAs: (v: string) => (v?.trim() ? v : undefined) })} />}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Role and branch" />
          <CardBody className="space-y-4">
            <Field label="Role" error={errors.role?.message} required>
              {(p) => (
                <Select {...p} {...form.register('role')}>
                  {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              )}
            </Field>
            {role === 'SUPER_ADMIN' ? (
              <Alert kind="warning" title="Full company access">A Super Admin can see and change everything in every branch, including staff and settings.</Alert>
            ) : (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">Branches <span className="text-danger-600">*</span></legend>
                {branches.isLoading ? (
                  <Skeleton className="h-20" />
                ) : (
                  <Controller
                    control={form.control}
                    name="branches"
                    render={({ field }) => (
                      <div className="grid gap-1 sm:grid-cols-2">
                        {branches.data?.data.map((b) => (
                          <Checkbox
                            key={b.id}
                            label={b.name}
                            description={`${b.code} · ${b.city}`}
                            checked={(field.value ?? []).includes(b.id)}
                            onChange={(e) => field.onChange(e.target.checked ? [...(field.value ?? []), b.id] : (field.value ?? []).filter((x) => x !== b.id))}
                          />
                        ))}
                      </div>
                    )}
                  />
                )}
                {errors.branches && <p role="alert" className="mt-1 text-xs font-medium text-danger-700">{errors.branches.message ?? 'Select at least one branch'}</p>}
              </fieldset>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Temporary password" description="Share it privately. It stops working once they choose their own." />
          <CardBody>
            <Field label="Temporary password" error={errors.temporaryPassword?.message} required>
              {(p) => (
                <Controller
                  control={form.control}
                  name="temporaryPassword"
                  render={({ field }) => <TempPasswordInput {...p} value={field.value} onChange={field.onChange} onGenerate={field.onChange} />}
                />
              )}
            </Field>
          </CardBody>
        </Card>

        <div className="flex justify-end gap-3">
          <ButtonLink href="/admin/staff" variant="secondary">Cancel</ButtonLink>
          <Button type="submit" loading={isSubmitting}>Create account</Button>
        </div>
      </form>
    </div>
  );
}
