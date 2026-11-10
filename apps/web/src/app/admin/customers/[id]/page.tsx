'use client';

import { type CustomerDto, INTERACTION_CHANNELS, NIGERIAN_STATES, PERMISSIONS, formatPhone, toWhatsAppNumber } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, MessageCircle, Phone, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { SOURCE_LABEL } from '@/components/admin/badges';
import { BranchSelect, Money } from '@/components/admin/commerce';
import { Button, buttonClasses } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys2, useAllBranches, useCustomer, useInteractions } from '@/lib/queries';
import { formatDate, formatDateTime, timeAgo } from '@/lib/utils';

const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', phone: 'Phone call', email: 'Email', in_store: 'In store', sms: 'SMS', system: 'System' };

function EditProfile({ c, onSaved }: { c: CustomerDto; onSaved: (c: CustomerDto) => void }) {
  const toast = useToast();
  const branches = useAllBranches();
  const [f, setF] = useState({ fullName: c.fullName, email: c.email ?? '', preferredBranch: c.preferredBranch?.id ?? '', tags: c.tags.join(', '), notes: c.notes ?? '' });
  const [addresses, setAddresses] = useState(c.addresses.map(({ id: _id, ...a }) => ({ ...a, label: a.label ?? '', area: a.area ?? '', landmark: a.landmark ?? '' })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<CustomerDto>(`/customers/${c.id}`, {
        fullName: f.fullName,
        email: f.email.trim() || null,
        preferredBranch: f.preferredBranch || null,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
        notes: f.notes,
        addresses: addresses.filter((a) => a.line1.trim()).map((a) => ({ ...a, label: a.label || undefined, area: a.area || undefined, landmark: a.landmark || undefined })),
      });
      onSaved(updated);
      toast.success('Customer saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Details" />
      <CardBody className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>{(p) => <Input {...p} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />}</Field>
          <Field label="Email">{(p) => <Input {...p} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Preferred branch">
            {(p) => (
              <Select {...p} value={f.preferredBranch} onChange={(e) => setF({ ...f, preferredBranch: e.target.value })}>
                <option value="">No preference</option>
                {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Tags" hint="Comma separated">{(p) => <Input {...p} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />}</Field>
          <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Delivery addresses</legend>
          {addresses.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_2fr_1fr_1fr_auto] sm:items-end">
              <Input aria-label="Label" placeholder="Home" value={a.label} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label="Street address" placeholder="Street address" value={a.line1} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, line1: e.target.value } : x)))} />
              <Input aria-label="City" placeholder="City" value={a.city} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, city: e.target.value } : x)))} />
              <Select aria-label="State" value={a.state} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, state: e.target.value } : x)))}>
                {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Button size="icon" variant="ghost" aria-label="Remove address" onClick={() => setAddresses(addresses.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setAddresses([...addresses, { label: '', line1: '', area: '', city: '', state: 'Kano', landmark: '', isDefault: addresses.length === 0 }])}><Plus className="h-4 w-4" /> Add address</Button>
        </fieldset>
        <Button loading={busy} onClick={save}>Save</Button>
      </CardBody>
    </Card>
  );
}

function History({ c }: { c: CustomerDto }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const items = useInteractions(c.id);
  const canRecord = Boolean(user?.permissions.includes(PERMISSIONS.CUSTOMERS_CREATE));
  const [form, setForm] = useState({ branch: user?.scope === 'branch' ? user.branches[0]?.id ?? '' : '', channel: 'whatsapp', direction: 'inbound', summary: '' });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!form.branch || form.summary.trim().length < 2) return toast.error('Choose a branch and describe the conversation.');
    setBusy(true);
    try {
      qc.setQueryData(keys2.interactions(c.id), await api.post(`/customers/${c.id}/interactions`, form));
      setForm({ ...form, summary: '' });
      toast.success('Recorded');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Communication history" description="Calls, chats and visits across all branches." />
      {canRecord && (
        <CardBody className="space-y-3 border-b border-line">
          <div className="flex flex-wrap gap-2">
            <BranchSelect value={form.branch} onChange={(b) => setForm({ ...form, branch: b })} className="w-44" />
            <Select aria-label="Channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-36">
              {INTERACTION_CHANNELS.filter((ch) => ch !== 'system').map((ch) => <option key={ch} value={ch}>{CHANNEL_LABEL[ch]}</option>)}
            </Select>
            <Select aria-label="Direction" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="w-40">
              <option value="inbound">Customer contacted us</option>
              <option value="outbound">We contacted them</option>
            </Select>
          </div>
          <Textarea aria-label="Summary" rows={2} placeholder="What was discussed?" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          <Button size="sm" loading={busy} onClick={add}>Record</Button>
        </CardBody>
      )}
      <CardBody>
        {items.isLoading && <Skeleton className="h-20" />}
        {items.data?.length === 0 && <p className="text-sm text-ink-muted">Nothing recorded yet.</p>}
        <ol className="space-y-4">
          {items.data?.map((i) => (
            <li key={i.id} className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-muted" aria-hidden>
                {i.direction === 'inbound' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{i.summary}</p>
                <p className="text-xs text-ink-muted">
                  {CHANNEL_LABEL[i.channel] ?? i.channel}{i.branch && ` · ${i.branch.code}`}{i.recordedBy && ` · ${i.recordedBy.fullName}`} · <time dateTime={i.createdAt} title={formatDateTime(i.createdAt)}>{timeAgo(i.createdAt)}</time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const customer = useCustomer(id);
  const back = <Link href="/admin/customers" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Customers</Link>;
  if (customer.isLoading) return <Skeleton className="h-96" />;
  if (customer.error || !customer.data) return <><PageHeader title="Customer" back={back} /><Alert>{customer.error ? errorMessage(customer.error) : 'Not found'}</Alert></>;
  const c = customer.data;
  const canEdit = Boolean(user?.permissions.includes(PERMISSIONS.CUSTOMERS_UPDATE));

  return (
    <>
      <PageHeader
        title={c.fullName}
        back={back}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {formatPhone(c.phone)}
            {c.hasAccount && <Badge tone="info">Online account</Badge>}
            {c.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
          </span>
        }
        actions={
          <>
            <a href={`tel:${c.phone}`} className={buttonClasses('secondary')}><Phone className="h-4 w-4" /> Call</a>
            <a href={`https://wa.me/${toWhatsAppNumber(c.phone)}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('primary')}><MessageCircle className="h-4 w-4" /> WhatsApp</a>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {canEdit && <EditProfile key={c.updatedAt} c={c} onSaved={(u) => { qc.setQueryData(keys2.customer(id), u); void qc.invalidateQueries({ queryKey: ['customers'] }); }} />}
          <History c={c} />
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Orders', value: c.stats.orderCount },
                  { label: 'Total spent', value: <Money kobo={c.stats.totalSpent} /> },
                  { label: 'Last order', value: c.stats.lastOrderAt ? formatDate(c.stats.lastOrderAt) : 'None yet' },
                  { label: 'Reservations', value: c.stats.reservationCount },
                  { label: 'Customer since', value: formatDate(c.createdAt) },
                  { label: 'Came via', value: SOURCE_LABEL[c.source] ?? c.source },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Branches" />
            <CardBody className="space-y-2 text-sm">
              <p><span className="text-ink-muted">Preferred:</span> {c.preferredBranch ? `${c.preferredBranch.code} · ${c.preferredBranch.name}` : 'None'}</p>
              <div className="flex flex-wrap gap-1.5"><span className="text-ink-muted">Served at:</span>{c.branchesServed.map((b) => <Badge key={b.id}>{b.code}</Badge>)}</div>
              {c.registeredBy && <p className="text-xs text-ink-faint">Registered by {c.registeredBy.fullName}</p>}
            </CardBody>
          </Card>
          {!canEdit && (c.email || c.notes || c.addresses.length > 0) && (
            <Card>
              <CardHeader title="Details" />
              <CardBody className="space-y-2 text-sm">
                {c.email && <p>{c.email}</p>}
                {c.addresses.map((a) => <p key={a.id}>{a.label && <strong>{a.label}: </strong>}{a.line1}, {a.city}, {a.state}</p>)}
                {c.notes && <p className="text-ink-muted">{c.notes}</p>}
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
