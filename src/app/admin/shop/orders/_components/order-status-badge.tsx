"use client";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-white/[0.05] text-[#6B6B6B]",
  paid: "bg-ops-accent/20 text-[#597794]",
  shipped: "bg-amber-500/20 text-amber-400",
  delivered: "bg-emerald-500/20 text-emerald-400",
  cancelled: "bg-red-500/10 text-[#6B6B6B] line-through",
  refunded: "bg-red-500/20 text-red-400",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-sm font-kosugi text-micro uppercase tracking-widest ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}
    >
      {status}
    </span>
  );
}
