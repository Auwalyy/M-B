'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { PasswordCard, ProfileCard, SessionsCard } from '@/components/account/account-panels';
import { Alert, Skeleton } from '@/components/ui/display';
import { useAuth } from '@/lib/auth';

function AccountContent() {
  const { status, user } = useAuth();
  const router = useRouter();
  const welcome = useSearchParams().get('welcome') === '1';

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login?next=/account');
    if (user?.mustChangePassword) router.replace('/change-password');
  }, [status, user, router]);

  if (!user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">My account</h1>
      <p className="mt-1 text-ink-muted">Hello, {user.fullName.split(' ')[0]}.</p>
      {welcome && (
        <Alert kind="success" className="mt-6" title="Your account is ready">
          You can now save your details and follow your orders and reservations here.
        </Alert>
      )}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <ProfileCard user={user} />
          <SessionsCard />
        </div>
        <PasswordCard />
      </div>
    </>
  );
}

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Suspense>
        <AccountContent />
      </Suspense>
    </div>
  );
}
