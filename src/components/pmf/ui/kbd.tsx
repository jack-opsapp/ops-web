import { cn } from '@/lib/cn';
interface KbdProps { children: React.ReactNode; className?: string; }
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd className={cn(
      'font-mono text-[11px] text-[color:var(--text-2)]',
      'bg-[rgba(255,255,255,0.06)] border border-[color:var(--line)]',
      'rounded-[3px] min-w-[20px] h-[20px] px-[5px]',
      'inline-flex items-center justify-center',
      className,
    )}>
      {children}
    </kbd>
  );
}
