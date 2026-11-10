'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { Skeleton } from '@/components/ui/display';
import { useAuth } from '@/lib/auth';
import { homeFor } from '@/lib/redirects';

export default function ChangePasswordPage() {
  const { status, user, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login?next=/change-password');
  }, [status, router]);

  if (!user) return <Skeleton className="h-80 w-full" />;

  return (
    <>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700">
        <KeyRound className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">
        {user.mustChangePassword ? 'Choose your own password' : 'Change password'}
      </h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">
        {user.mustChangePassword
          ? `Welcome, ${user.fullName.split(' ')[0]}. You signed in with a temporary password. Choose a private password only you know before continuing.`
          : 'Your other devices will be signed out.'}
      </p>
      <ChangePasswordForm
        currentLabel={user.mustChangePassword ? 'Temporary password' : 'Current password'}
        onDone={(u) => router.replace(homeFor(u))}
      />
      <button onClick={() => logout().then(() => router.replace('/login'))} className="mt-6 text-sm font-medium text-ink-muted hover:text-ink">
        Sign out instead
      </button>
    </>
  );
}
