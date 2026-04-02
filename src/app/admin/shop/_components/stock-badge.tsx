"use client";

interface StockBadgeProps {
  available: number;
  total: number;
}

export function StockBadge({ available, total }: StockBadgeProps) {
  const color =
    available > 10
      ? "text-emerald-400"
      : available > 3
        ? "text-amber-400"
        : "text-red-400";

  return (
    <span className={`font-mohave text-[13px] ${color}`}>
      {available} <span className="text-[#6B6B6B]">/ {total}</span>
    </span>
  );
}
