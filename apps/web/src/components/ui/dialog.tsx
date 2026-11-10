'use client';

import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button, type ButtonVariant } from './button';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px]" />
        <D.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
            'rounded-xl border border-line bg-surface shadow-pop focus:outline-none',
            size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-base font-semibold text-ink">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-ink-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close className="rounded-md p-1 text-ink-faint hover:bg-black/5 hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </D.Close>
          </div>
          {children && <div className="px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-subtle px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation step for consequential actions (deactivation, revocation). */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  variant = 'danger',
  onConfirm,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              variant={variant}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } catch {
                  // The caller shows the error (toast); keep the dialog open.
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      />
    </>
  );
}
