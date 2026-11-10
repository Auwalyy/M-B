'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema } from '@mb/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';

export default function RegisterPage() {
  const { register: signUp } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof registerSchema>, unknown, z.output<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', phone: '', email: undefined, password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signUp(values);
      router.replace('/account?welcome=1');
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['fullName', 'phone', 'email', 'password']));
    }
  });

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-ink-muted">Track orders, make reservations and check out faster.</p>
      {formError && <Alert kind="error" className="mt-6">{formError}</Alert>}
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="Full name" error={errors.fullName?.message} required>
          {(p) => <Input {...p} autoComplete="name" autoFocus {...form.register('fullName')} />}
        </Field>
        <Field label="Phone number" error={errors.phone?.message} hint="We use this to confirm orders and reservations." required>
          {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" {...form.register('phone')} />}
        </Field>
        <Field label="Email address" error={errors.email?.message} hint="Optional, for receipts and password recovery.">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              {...form.register('email', { setValueAs: (v: string) => (v?.trim() ? v : undefined) })}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number." required>
          {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('password')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-brand-700 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
