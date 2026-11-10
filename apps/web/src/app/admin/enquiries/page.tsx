'use client';

import { ENQUIRY_STATUSES, type EnquiryDto, PERMISSIONS, formatPhone, staffEnquirySchema } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { BranchSelect, ProductPicker, type PickedItem } from '@/components/admin/commerce';
import { CHANNEL, ENQUIRY_STATUS, EnquiryStatusBadge } from '@/components/admin/enquiry-status';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useEnquiries } from '@/lib/queries';
import { timeAgo } from '@/lib/utils';

function LogEnquiry({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const empty = { branch: user?.scope === 'branch' ? user.branches[0]?.id ?? '' : '', channel: 'whatsapp', name: '', phone: '', email: '', subject: '', message: '' };
  const [f, setF] = useState(empty);
  const [product, setProduct] = useState<PickedItem | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const body = { ...f, email: f.email.trim() || undefined, product: product?.product.id };
    const parsed = staffEnquirySchema.safeParse(body);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[i.path.join('.')] ??= i.message;
      return setErrors(e);
    }
    setBusy(true);
    try {
      const e = await api.post<EnquiryDto>('/enquiries/log', body);
      await qc.invalidateQueries({ queryKey: ['enquiries'] });
      toast.success(`${e.reference} logged`);
      setF(empty);
      setProduct(null);
      onClose();
      router.push(`/admin/enquiries/${e.id}`);
    } catch (err) {
      setErrors({ _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Log an enquiry" description="For questions that came in by WhatsApp, phone or in person." size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Log enquiry</Button></>}>
      <div className="space-y-4">
        {errors._ && <Alert>{errors._}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Branch" error={errors.branch} required>{() => <BranchSelect value={f.branch} onChange={(b) => setF({ ...f, branch: b })} className="w-full" />}</Field>
          <Field label="Came in by" required>
            {(p) => <Select {...p} value={f.channel} onChange={set('channel')}><option value="whatsapp">WhatsApp</option><option value="phone">Phone call</option><option value="walk_in">Walk-in</option></Select>}
          </Field>
          <Field label="Customer name" error={errors.name} required>{(p) => <Input {...p} value={f.name} onChange={set('name')} />}</Field>
          <Field label="Phone" error={errors.phone} required hint="Linked to the customer record if the number is known.">{(p) => <Input {...p} type="tel" value={f.phone} onChange={set('phone')} />}</Field>
          <Field label="Subject" error={errors.subject} required className="sm:col-span-2">{(p) => <Input {...p} value={f.subject} onChange={set('subject')} placeholder="Price and availability of 2-door fridge" />}</Field>
          <Field label="Details" error={errors.message} required className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} value={f.message} onChange={set('message')} />}</Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Product asked about (optional)</p>
          {product ? (
            <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
              <span>{product.product.name}{product.variant && ` · ${product.variant.label}`}</span>
              <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>Change</Button>
            </div>
          ) : (
            <ProductPicker onPick={setProduct} />
          )}
        </div>
      </div>
    </Dialog>
  );
}

export default function EnquiriesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [branch, setBranch] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [logging, setLogging] = useState(false);
  const search = useDeferredValue(q);
  const list = useEnquiries({ status, branch, q: search, assignedToMe: mine ? 'true' : undefined, page, limit: 25 });
  const canManage = Boolean(user?.permissions.includes(PERMISSIONS.ENQUIRIES_MANAGE));

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Questions from the website, WhatsApp, phone calls and visitors. Reply quickly: new ones are highlighted."
        actions={canManage && <Button onClick={() => setLogging(true)}><Plus className="h-4 w-4" /> Log enquiry</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Reference, name, phone or subject" className="pl-9" aria-label="Search enquiries" />
          </div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40" aria-label="Status">
            <option value="">Any status</option>
            {ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{ENQUIRY_STATUS[s].label}</option>)}
          </Select>
          <BranchSelect value={branch} onChange={(b) => { setBranch(b); setPage(1); }} allowAll />
          <Checkbox label="Assigned to me" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} className="p-1" />
        </div>
        <DataTable<EnquiryDto>
          caption="Enquiries"
          rows={list.data?.data}
          rowKey={(e) => e.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          onRowClick={(e) => router.push(`/admin/enquiries/${e.id}`)}
          meta={list.data?.meta}
          onPageChange={setPage}
          empty={{ icon: MessageSquare, title: 'No enquiries', description: 'Website enquiries arrive here automatically.' }}
          columns={[
            { header: 'Enquiry', cell: (e) => <div><p className={e.status === 'new' ? 'font-bold' : 'font-medium'}>{e.subject}</p><p className="text-xs text-ink-muted">{e.reference} · {CHANNEL[e.channel]}</p></div> },
            { header: 'From', cell: (e) => <div className="text-sm">{e.contact.name}{e.customer && <Badge tone="info" className="ml-1">Customer</Badge>}<p className="text-xs text-ink-muted">{formatPhone(e.contact.phone)}</p></div> },
            { header: 'Branch', hideOnMobile: true, cell: (e) => <Badge>{e.branch.code}</Badge> },
            { header: 'Assigned', hideOnMobile: true, cell: (e) => <span className="text-ink-muted">{e.assignedTo?.fullName ?? '—'}</span> },
            { header: 'Status', cell: (e) => <EnquiryStatusBadge status={e.status} /> },
            { header: 'Received', hideOnMobile: true, cell: (e) => <span className="text-ink-muted">{timeAgo(e.createdAt)}</span> },
          ]}
        />
      </Card>
      <LogEnquiry open={logging} onClose={() => setLogging(false)} />
    </>
  );
}
