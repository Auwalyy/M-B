'use client';

import { ENQUIRY_STATUSES, type EnquiryDto, PERMISSIONS, type StaffDto, formatPhone, toWhatsAppNumber } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, Phone, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CHANNEL, ENQUIRY_STATUS, EnquiryStatusBadge } from '@/components/admin/enquiry-status';
import { Button, ButtonLink, buttonClasses } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader, DescriptionList, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys2, useEnquiry } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

export default function EnquiryPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const enquiry = useEnquiry(id);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = Boolean(user?.permissions.includes(PERMISSIONS.ENQUIRIES_MANAGE));
  const canListStaff = Boolean(user?.permissions.includes(PERMISSIONS.USERS_READ));
  const branchId = enquiry.data?.branch.id;
  const staff = useQuery({
    queryKey: ['staff', 'assignable', branchId],
    queryFn: () => api.page<StaffDto>('/users', { branch: branchId, status: 'active', limit: 100 }),
    enabled: Boolean(branchId && canListStaff && canManage),
  });

  const back = <Link href="/admin/enquiries" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Enquiries</Link>;
  if (enquiry.isLoading) return <Skeleton className="h-96" />;
  if (enquiry.error || !enquiry.data) return <><PageHeader title="Enquiry" back={back} /><Alert>{enquiry.error ? errorMessage(enquiry.error) : 'Not found'}</Alert></>;
  const e = enquiry.data;

  const update = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      qc.setQueryData(keys2.enquiry(id), await api.patch<EnquiryDto>(`/enquiries/${id}`, body));
      void qc.invalidateQueries({ queryKey: ['enquiries'] });
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Staff who can be assigned: the branch team (if the user may list staff), otherwise just themselves.
  const assignees = canListStaff ? (staff.data?.data ?? []).map((s) => ({ id: s.id, name: s.fullName })) : user ? [{ id: user.id, name: `${user.fullName} (me)` }] : [];
  if (e.assignedTo && !assignees.some((a) => a.id === e.assignedTo!.id)) assignees.push({ id: e.assignedTo.id, name: e.assignedTo.fullName });
  const reply = `Hello ${e.contact.name.split(' ')[0]}, thank you for contacting Mudassir & Brothers (${e.branch.name}) about "${e.subject}". `;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={e.subject}
        back={back}
        description={<span className="inline-flex flex-wrap items-center gap-2">{e.reference} · {CHANNEL[e.channel]} · {e.branch.name} <EnquiryStatusBadge status={e.status} /></span>}
        actions={
          <>
            <a href={`tel:${e.contact.phone}`} className={buttonClasses('secondary')}><Phone className="h-4 w-4" /> Call</a>
            <a href={`https://wa.me/${toWhatsAppNumber(e.contact.phone)}?text=${encodeURIComponent(reply)}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('primary')}>
              <MessageCircle className="h-4 w-4" /> Reply on WhatsApp
            </a>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Message" />
            <CardBody className="space-y-3">
              <p className="text-sm whitespace-pre-line">{e.message}</p>
              {e.product && <p className="text-sm"><span className="text-ink-muted">About:</span> <Link href={`/admin/catalog/products/${e.product.id}`} className="font-medium text-brand-700 hover:underline">{e.product.name}</Link> ({e.product.sku})</p>}
              <p className="text-xs text-ink-faint">Received {formatDateTime(e.createdAt)}{e.createdBy && `, logged by ${e.createdBy.fullName}`}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Follow-up notes" description="Notes are also added to the customer's history." />
            <CardBody className="space-y-4">
              {e.notes.length === 0 && <p className="text-sm text-ink-muted">No notes yet.</p>}
              <ol className="space-y-3">
                {e.notes.map((n, i) => (
                  <li key={i} className="rounded-lg bg-subtle px-3 py-2">
                    <p className="text-sm">{n.text}</p>
                    <p className="mt-1 text-xs text-ink-muted">{n.by?.fullName ?? 'System'} · {formatDateTime(n.at)}</p>
                  </li>
                ))}
              </ol>
              {canManage && (
                <div className="space-y-2">
                  <Textarea aria-label="New note" rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. Sent price on WhatsApp; customer will visit on Saturday" />
                  <Button size="sm" loading={busy} disabled={!note.trim()} onClick={async () => { if (await update({ note }, 'Note added')) setNote(''); }}>Add note</Button>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
        <aside className="space-y-6">
          {canManage && (
            <Card>
              <CardHeader title="Handling" />
              <CardBody className="space-y-4">
                <Field label="Status">
                  {(p) => (
                    <Select {...p} value={e.status} disabled={busy} onChange={(ev) => update({ status: ev.target.value }, 'Status updated')}>
                      {ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{ENQUIRY_STATUS[s].label}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Assigned to">
                  {(p) => (
                    <Select {...p} value={e.assignedTo?.id ?? ''} disabled={busy} onChange={(ev) => update({ assignedTo: ev.target.value || null }, 'Assignment updated')}>
                      <option value="">Unassigned</option>
                      {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  )}
                </Field>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Contact" />
            <CardBody className="space-y-4">
              <DescriptionList items={[{ label: 'Name', value: e.contact.name }, { label: 'Phone', value: formatPhone(e.contact.phone) }, { label: 'Email', value: e.contact.email }]} />
              {e.customer ? (
                <ButtonLink href={`/admin/customers/${e.customer.id}`} variant="secondary" size="sm">Open customer profile</ButtonLink>
              ) : (
                user?.permissions.includes(PERMISSIONS.CUSTOMERS_CREATE) && (
                  <ButtonLink href={`/admin/customers/new?phone=${encodeURIComponent(e.contact.phone)}&name=${encodeURIComponent(e.contact.name)}`} variant="secondary" size="sm">
                    <UserPlus className="h-4 w-4" /> Register as customer
                  </ButtonLink>
                )
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
