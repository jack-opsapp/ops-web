'use client';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'default' | 'secondary' | 'ghost' | 'destructive';

interface PmfButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const VARIANT: Record<Variant, string> = {
  primary:     'bg-transparent text-[color:var(--ops-accent)] border border-[color:var(--ops-accent)] hover:bg-[color:var(--ops-accent)] hover:text-black',
  default:     'bg-[rgba(255,255,255,0.07)] text-[color:var(--text-2)] border border-[color:var(--line)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[color:var(--text)]',
  secondary:   'bg-transparent text-[color:var(--text-2)] border border-[color:var(--line)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[color:var(--text)]',
  ghost:       'bg-transparent text-[color:var(--text-2)] border border-transparent hover:bg-[rgba(255,255,255,0.05)] hover:text-[color:var(--text)]',
  destructive: 'bg-[color:var(--rose-soft)] text-[color:var(--rose)] border border-[color:var(--rose-line)]',
};

export const PmfButton = forwardRef<HTMLButtonElement, PmfButtonProps>(
  ({ variant = 'default', className, children, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center gap-2 min-h-[36px] px-4 py-[9px] rounded-[2.5px]',
        'font-cakemono font-light uppercase text-[14px]',
        'transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-[color:var(--ops-accent)] focus-visible:outline-offset-2',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);
PmfButton.displayName = 'PmfButton';
