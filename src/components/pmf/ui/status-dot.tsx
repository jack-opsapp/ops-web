import { cn } from '@/lib/utils/cn';
import type { MarkerStatus } from '@/lib/pmf/types';

interface StatusDotProps {
  status: MarkerStatus | 'neutral';
  size?: number;
  className?: string;
  label?: string;
}

const COLOR: Record<string, string> = {
  green:   'var(--olive)',
  amber:   'var(--tan)',
  red:     'var(--rose)',
  neutral: 'var(--text-mute)',
};

export function StatusDot({ status, size = 6, className, label }: StatusDotProps) {
  const ariaLabel = label ?? `status ${status}`;
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn('inline-block rounded-full transition-colors duration-150', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: COLOR[status],
      }}
    />
  );
}
