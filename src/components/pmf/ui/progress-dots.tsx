import { cn } from '@/lib/utils/cn';
import type { MarkerStatus } from '@/lib/pmf/types';

interface ProgressDotsProps {
  value: number;
  target: number;
  status: MarkerStatus;
  size?: number;
}

const FILL: Record<MarkerStatus, string> = {
  green: 'var(--olive)',
  amber: 'var(--tan)',
  red:   'var(--rose)',
};

export function ProgressDots({ value, target, status, size = 6 }: ProgressDotsProps) {
  const clamped = Math.max(0, Math.min(value, target));
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`${value} of ${target}`}>
      {Array.from({ length: target }, (_, i) => (
        <span
          key={i}
          className={cn('inline-block rounded-full', i < clamped ? 'opacity-100' : 'opacity-40')}
          style={{
            width: size, height: size,
            backgroundColor: i < clamped ? FILL[status] : 'var(--fill-neutral-dim)',
          }}
        />
      ))}
    </div>
  );
}
