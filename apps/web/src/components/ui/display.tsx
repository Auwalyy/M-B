import { AlertTriangle, CheckCircle2, Info, type LucideIcon, XCircle } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-line bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

const tones = {
  neutral: 'bg-black/5 text-ink-muted',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-700',
  accent: 'bg-accent-50 text-accent-700',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-shimmer rounded-md bg-[linear-gradient(90deg,#efede7_0px,#f7f6f2_200px,#efede7_400px)] bg-[length:800px_100%]', className)}
    />
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const alertStyles = {
  error: { icon: XCircle, cls: 'border-danger-600/25 bg-danger-50 text-danger-700' },
  warning: { icon: AlertTriangle, cls: 'border-warning-700/20 bg-warning-50 text-warning-700' },
  success: { icon: CheckCircle2, cls: 'border-success-700/20 bg-success-50 text-success-700' },
  info: { icon: Info, cls: 'border-info-700/20 bg-info-50 text-info-700' },
};

export function Alert({ kind = 'error', title, children, action, className }: { kind?: keyof typeof alertStyles; title?: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { icon: Icon, cls } = alertStyles[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6">
      {back && <div className="mb-3">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium tracking-wide text-ink-faint uppercase">{i.label}</dt>
          <dd className="mt-1 text-sm break-words text-ink">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
