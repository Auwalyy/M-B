'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { password } from '@mb/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { api, errorMessage } from '@/lib/api';

const schema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function ResetForm() {
  const token = useSearchParams().get('token');
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  if (!token) {
    return (
      <Alert kind="error" title="This reset link is incomplete">
        Open the link from your email again, or <Link href="/forgot-password" className="font-semibold underline">request a new one</Link>.
      </Alert>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/auth/reset-password', { token, password: values.password });
      router.replace('/login?reset=1');
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-ink-muted">You will be signed out of every device after the change.</p>
      {formError && (
        <Alert kind="error" className="mt-6">
          {formError} <Link href="/forgot-password" className="font-semibold underline">Request a new link</Link>
        </Alert>
      )}
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="New password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number." required>
          {(p) => <PasswordInput {...p} autoComplete="new-password" autoFocus {...form.register('password')} />}
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message} required>
          {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Reset password</Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
