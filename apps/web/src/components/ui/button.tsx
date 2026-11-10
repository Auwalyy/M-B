import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { type ButtonHTMLAttributes, type ComponentProps, forwardRef } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm disabled:bg-brand-700/60',
  accent: 'bg-accent-500 text-white hover:bg-accent-600 shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-subtle hover:border-ink-faint',
  ghost: 'text-ink-muted hover:bg-black/5 hover:text-ink',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 shadow-sm',
  'danger-outline': 'border border-danger-600/40 text-danger-700 bg-surface hover:bg-danger-50',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-9 w-9 justify-center',
} as const;

export type ButtonVariant = keyof typeof variants;

export function buttonClasses(variant: ButtonVariant = 'primary', size: keyof typeof sizes = 'md', className?: string) {
  return cn(
    'inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-60',
    variants[variant],
    sizes[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof sizes;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: keyof typeof sizes }) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
