import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useId,
} from 'react';
import { cn } from '@/lib/utils';

const control =
  'block w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint ' +
  'transition-colors hover:border-ink-faint focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-muted ' +
  'aria-[invalid=true]:border-danger-600 aria-[invalid=true]:focus:ring-danger-600/20';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, 'h-10', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(control, 'min-h-24 py-2', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, 'h-10 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235f6964' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...props}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: string;
  /** Rendered as the control; receives id and aria wiring through the render function. */
  children: (ids: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
}

/** Label, control, hint and error, wired together for screen readers. */
export function Field({ label, children, error, hint, required, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger-600" aria-hidden>*</span>}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint && !error && <p id={hintId} className="text-xs text-ink-muted">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs font-medium text-danger-700">{error}</p>}
    </div>
  );
}

export function Checkbox({ label, description, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={props.id ?? id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-subtle', props.disabled && 'cursor-not-allowed opacity-60', className)}>
      <input id={props.id ?? id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-brand-700" {...props} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
        {description && <p className="text-xs text-ink-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-line-strong',
        )}
      >
        <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}
