import { cn } from '@/lib/cn';

interface SlashHeaderProps {
  children: React.ReactNode;
  variant?: 'section' | 'panel-title' | 'page-title';
  className?: string;
  trailing?: React.ReactNode;
}

const VARIANT_CLASS = {
  'section':     'font-cakemono font-light uppercase text-[18px] tracking-[0.04em] leading-none',
  'panel-title': 'font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)]',
  'page-title':  'font-cakemono font-light uppercase text-[22px] tracking-[0.02em] leading-none',
};

export function SlashHeader({ children, variant = 'section', className, trailing }: SlashHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <h2 className={cn(VARIANT_CLASS[variant])}>
        <span className="mr-1 text-[color:var(--text-mute)] font-mono">//</span>
        {children}
      </h2>
      {trailing && <div>{trailing}</div>}
    </div>
  );
}
