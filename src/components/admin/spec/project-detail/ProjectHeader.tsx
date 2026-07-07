import Link from "next/link";
import type { SpecProjectHeader, SpecProjectStatus, SpecTier } from "@/lib/admin/spec-types";

interface ProjectHeaderProps {
  header: SpecProjectHeader;
}

const STATUS_TONE: Record<SpecProjectStatus, string> = {
  awaiting_owner_approval: "text-tan border-tan/40",
  awaiting_deposit: "text-tan border-tan/40",
  deposit_paid: "text-olive border-olive/40",
  discovery: "text-olive border-olive/40",
  building: "text-olive border-olive/40",
  on_hold: "text-rose border-rose/40",
  stalled_on_hold: "text-rose border-rose/40",
  support: "text-olive border-olive/40",
  on_retainer: "text-olive border-olive/40",
  completed: "text-text-3 border-white/[0.10]",
  stalled: "text-text-3 border-white/[0.10]",
  cancelled: "text-rose border-rose/40",
  refunded: "text-rose border-rose/40",
};

const TIER_TONE: Record<SpecTier, string> = {
  setup: "text-olive border-olive/30",
  build: "text-tan border-tan/30",
  enterprise: "text-rose border-rose/40",
};

function statusLabel(status: SpecProjectStatus): string {
  return status.replace(/_/g, " ").toUpperCase();
}

export function ProjectHeader({ header }: ProjectHeaderProps) {
  return (
    <header className="border-b border-white/[0.08] px-8 py-6">
      <div className="mb-3">
        <Link
          href="/admin/spec"
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute transition-colors duration-150 ease-smooth hover:text-text-3"
        >
          <span aria-hidden="true">{"// "}</span>
          BACK TO SPEC OPERATIONS
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-cakemono text-[28px] font-light uppercase leading-none text-text">
            <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
              {"//"}
            </span>
            {header.customerLabel}
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute">
            <span className="text-text-mute">[</span>
            PROJECT ID · {header.id.slice(0, 8)}
            <span className="text-text-mute">]</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge label={header.tier.toUpperCase()} tone={TIER_TONE[header.tier]} />
          {header.originalTier && header.originalTier !== header.tier && (
            <Badge
              label={`WAS ${header.originalTier.toUpperCase()}`}
              tone="text-text-mute border-white/[0.10]"
            />
          )}
          <Badge label={statusLabel(header.status)} tone={STATUS_TONE[header.status]} />
          {header.isTest && (
            <Badge label="TEST MODE" tone="text-tan border-tan/40" />
          )}
        </div>
      </div>
    </header>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={`rounded-chip border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}
    >
      {label}
    </span>
  );
}
