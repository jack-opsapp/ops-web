import { cn } from '@/lib/utils/cn';

type TagVariant = 'default' | 'olive' | 'tan' | 'rose';
interface TagProps {
  children: React.ReactNode;
  variant?: TagVariant;
  className?: string;
}

const VARIANT: Record<TagVariant, string> = {
  default: 'text-[color:var(--text-2)] bg-[rgba(255,255,255,0.05)] border-[color:var(--line)]',
  olive:   'text-[color:var(--olive)] bg-[color:var(--olive-soft)] border-[color:var(--olive-line)]',
  tan:     'text-[color:var(--tan)]   bg-[color:var(--tan-soft)]   border-[color:var(--tan-line)]',
  rose:    'text-[color:var(--rose)]  bg-[color:var(--rose-soft)]  border-[color:var(--rose-line)]',
};

export function Tag({ children, variant = 'default', className }: TagProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1',
      'font-mono font-medium uppercase text-[11px] tracking-[0.12em]',
      'px-1.5 py-0.5 rounded-[2.5px] border',
      VARIANT[variant],
      className,
    )}>
      {children}
    </span>
  );
}
