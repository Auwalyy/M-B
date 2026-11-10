'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@mb/shared';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordSchema>, unknown, z.output<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSentTo(email);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  if (sentTo) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <MailCheck className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-ink-muted">
          If an account exists for <strong className="text-ink">{sentTo}</strong>, we have sent a link to reset your password. It expires in 60 minutes.
        </p>
        <p className="mt-6 text-sm text-ink-muted">
          Staff without an email address: ask your branch administrator to reset your password.
        </p>
        <Link href="/login" className="mt-8 inline-block text-sm font-semibold text-brand-700 hover:underline">Back to sign in</Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-muted">Enter the email address on your account and we will send you a reset link.</p>
      {formError && <Alert kind="error" className="mt-6">{formError}</Alert>}
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="Email address" error={form.formState.errors.email?.message} required>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus {...form.register('email')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>Send reset link</Button>
      </form>
      <p className="mt-8 text-center text-sm">
        <Link href="/login" className="font-semibold text-brand-700 hover:underline">Back to sign in</Link>
      </p>
    </>
  );
}
