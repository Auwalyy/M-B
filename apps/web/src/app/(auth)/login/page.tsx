'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@mb/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import { homeFor, safeNext } from '@/lib/redirects';

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values);
      const next = safeNext(params.get('next'));
      router.replace(user.mustChangePassword ? '/change-password' : (next ?? homeFor(user)));
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['identifier', 'password']));
    }
  });

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">Use your email address or phone number.</p>
      {params.get('reset') === '1' && (
        <Alert kind="success" className="mt-6">Your password has been reset. Sign in with your new password.</Alert>
      )}
      {formError && <Alert kind="error" className="mt-6">{formError}</Alert>}
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="Email or phone number" error={errors.identifier?.message} required>
          {(p) => <Input {...p} autoComplete="username" autoFocus placeholder="you@example.com or 0803 123 4567" {...form.register('identifier')} />}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(p) => <PasswordInput {...p} autoComplete="current-password" {...form.register('password')} />}
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Sign in</Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-muted">
        New customer?{' '}
        <Link href="/register" className="font-semibold text-brand-700 hover:underline">Create an account</Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    // The fallback is server-rendered, so the heading paints before JavaScript loads.
    <Suspense
      fallback={
        <>
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">Use your email address or phone number.</p>
          <div className="mt-6 h-64" aria-hidden />
        </>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
