'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type AuthUserDto, password } from '@mb/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: password, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'Choose a password different from the current one', path: ['newPassword'] });

export function ChangePasswordForm({ onDone, currentLabel = 'Current password' }: { onDone?: (user: AuthUserDto) => void; currentLabel?: string }) {
  const { setUser } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    setDone(false);
    try {
      const user = await api.post<AuthUserDto>('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      setUser(user);
      form.reset();
      setDone(true);
      onDone?.(user);
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['currentPassword', 'newPassword']));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert kind="error">{formError}</Alert>}
      {done && <Alert kind="success">Password changed. Your other devices have been signed out.</Alert>}
      <Field label={currentLabel} error={errors.currentPassword?.message} required>
        {(p) => <PasswordInput {...p} autoComplete="current-password" {...form.register('currentPassword')} />}
      </Field>
      <Field label="New password" error={errors.newPassword?.message} hint="At least 8 characters, with a letter and a number." required>
        {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('newPassword')} />}
      </Field>
      <Field label="Confirm new password" error={errors.confirm?.message} required>
        {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />}
      </Field>
      <Button type="submit" loading={isSubmitting}>Change password</Button>
    </form>
  );
}
