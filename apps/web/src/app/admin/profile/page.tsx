'use client';

import { PasswordCard, ProfileCard, SessionsCard } from '@/components/account/account-panels';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/display';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

export default function AdminProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title="My profile" description="Your details, password and signed-in devices." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <ProfileCard user={user} />
          <SessionsCard />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Access" description="Set by your administrator." />
            <CardBody className="space-y-3 text-sm">
              <p><span className="text-ink-muted">Role:</span> <strong>{user.roleName}</strong></p>
              <div>
                <p className="text-ink-muted">Branches</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {user.scope === 'company' ? <Badge tone="brand">All branches</Badge> : user.branches.map((b) => <Badge key={b.id} tone="brand">{b.code} · {b.name}</Badge>)}
                </div>
              </div>
              {user.grants.length > 0 && (
                <div>
                  <p className="text-ink-muted">Temporary access</p>
                  <ul className="mt-1 space-y-1">
                    {user.grants.map((g) => (
                      <li key={g.id}><Badge tone="accent">{g.branch.code}</Badge> until {formatDate(g.expiresAt)}: {g.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
          <PasswordCard />
        </div>
      </div>
    </>
  );
}
