'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type AuthUserDto, type SessionDto, formatPhone, updateProfileSchema } from '@mb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import { describeDevice, timeAgo } from '@/lib/utils';
import { ChangePasswordForm } from './change-password-form';

export function ProfileCard({ user }: { user: AuthUserDto }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof updateProfileSchema>, unknown, z.output<typeof updateProfileSchema>>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { fullName: user.fullName, phone: user.phone ? formatPhone(user.phone) : '', email: user.email ?? undefined },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await api.patch<AuthUserDto>('/auth/me', values);
      setUser(updated);
      form.reset({ fullName: updated.fullName, phone: updated.phone ? formatPhone(updated.phone) : '', email: updated.email ?? undefined });
      toast.success('Profile saved');
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['fullName', 'phone', 'email']));
    }
  });

  return (
    <Card>
      <CardHeader title="Profile" description="Your name and contact details." />
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError && <Alert kind="error">{formError}</Alert>}
          <Field label="Full name" error={errors.fullName?.message} required>
            {(p) => <Input {...p} autoComplete="name" {...form.register('fullName')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone number" error={errors.phone?.message} required>
              {(p) => <Input {...p} type="tel" autoComplete="tel" {...form.register('phone')} />}
            </Field>
            <Field label="Email address" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email', { setValueAs: (v: string) => (v?.trim() ? v : undefined) })} />}
            </Field>
          </div>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function PasswordCard() {
  return (
    <Card>
      <CardHeader title="Password" description="Changing your password signs you out on your other devices." />
      <CardBody>
        <ChangePasswordForm />
      </CardBody>
    </Card>
  );
}

export function SessionsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: () => api.get<SessionDto[]>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      toast.success('Device signed out');
      void qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'),
    onSuccess: (r) => {
      toast.success(r.revoked ? `Signed out ${r.revoked} other device${r.revoked === 1 ? '' : 's'}` : 'No other devices were signed in');
      void qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;

  return (
    <Card>
      <CardHeader
        title="Signed-in devices"
        description="If you don't recognise a device, sign it out and change your password."
        actions={others > 0 && <Button size="sm" variant="secondary" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>Sign out all others</Button>}
      />
      <CardBody className="p-0">
        {sessions.isLoading && <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
        {sessions.error && <div className="p-5"><Alert>{errorMessage(sessions.error)}</Alert></div>}
        <ul className="divide-y divide-line">
          {sessions.data?.map((s) => {
            const mobile = /Android|iPhone|iPad/.test(s.userAgent ?? '');
            const Icon = mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                <Icon className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {describeDevice(s.userAgent)} {s.current && <Badge tone="success" className="ml-1">This device</Badge>}
                  </p>
                  <p className="text-xs text-ink-muted">Active {timeAgo(s.lastUsedAt)}{s.ip ? ` · ${s.ip}` : ''}</p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
