'use client';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { daysUntilGate } from '@/lib/pmf/formatters';

export function CountdownChip() {
  const [days, setDays] = useState(() => daysUntilGate());

  useEffect(() => {
    const id = setInterval(() => setDays(daysUntilGate()), 60_000 * 30);
    return () => clearInterval(id);
  }, []);

  const colorClass =
    days <= 7  ? 'text-[color:var(--rose)]' :
    days <= 30 ? 'text-[color:var(--tan)]'  :
                 'text-[color:var(--text-3)]';

  return (
    <span className={cn('font-mono text-[11px] tracking-[0.16em] uppercase', colorClass)}>
      <span className="text-[color:var(--text-3)]">[</span>
      GATE B · {days} DAYS
      <span className="text-[color:var(--text-3)]">]</span>
    </span>
  );
}
