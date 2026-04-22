'use client';
import { useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils/cn';

interface HeroNumberProps {
  value: number;
  total?: number;
  className?: string;
}

export function HeroNumber({ value, total, className }: HeroNumberProps) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const displayed = useTransform(mv, (v) => Math.round(v).toString());

  useEffect(() => {
    if (reduced) { mv.set(value); return; }
    const controls = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return controls.stop;
  }, [value, reduced, mv]);

  return (
    <div
      className={cn(
        'font-mohave font-light text-[80px] leading-none tabular-nums',
        'text-[color:var(--text)]',
        className,
      )}
      aria-label={total != null ? `${value} of ${total}` : `${value}`}
    >
      <motion.span>{displayed}</motion.span>
      {total != null && (
        <span className="text-[color:var(--text-3)] text-[48px]"> / {total}</span>
      )}
    </div>
  );
}
