'use client';
import { motion, useReducedMotion } from 'framer-motion';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  className?: string;
}

export function Sparkline({
  data, width = 100, height = 20,
  strokeColor = 'var(--text-3)', className,
}: SparklineProps) {
  const reduced = useReducedMotion();
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / Math.max(1, data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <motion.path
        d={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1}
        initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}
