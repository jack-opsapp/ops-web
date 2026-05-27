import Link from "next/link";
import type { SpecProjectHeader, SpecProjectStatus, SpecTier } from "@/lib/admin/spec-types";

interface ProjectHeaderProps {
  header: SpecProjectHeader;
}

const STATUS_TONE: Record<SpecProjectStatus, string> = {
  awaiting_owner_approval: "text-[#C4A868] border-[#C4A868]/40",
  awaiting_deposit: "text-[#C4A868] border-[#C4A868]/40",
  deposit_paid: "text-[#9DB582] border-[#9DB582]/40",
  discovery: "text-[#6F94B0] border-[#6F94B0]/40",
  building: "text-[#6F94B0] border-[#6F94B0]/40",
  on_hold: "text-[#B58289] border-[#B58289]/40",
  stalled_on_hold: "text-[#B58289] border-[#B58289]/40",
  support: "text-[#9DB582] border-[#9DB582]/40",
  on_retainer: "text-[#9DB582] border-[#9DB582]/40",
  completed: "text-[#8A8A8A] border-white/[0.10]",
  stalled: "text-[#8A8A8A] border-white/[0.10]",
  cancelled: "text-[#B58289] border-[#B58289]/40",
  refunded: "text-[#B58289] border-[#B58289]/40",
};

const TIER_TONE: Record<SpecTier, string> = {
  setup: "text-[#9DB582] border-[#9DB582]/30",
  build: "text-[#C4A868] border-[#C4A868]/30",
  enterprise: "text-[#6F94B0] border-[#6F94B0]/40",
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
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-[#8A8A8A]"
        >
          <span aria-hidden="true">{"// "}</span>
          BACK TO SPEC OPERATIONS
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-cakemono text-[28px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            {header.customerLabel}
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            PROJECT ID · {header.id.slice(0, 8)}
            <span className="text-[#3A3A3A]">]</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge label={header.tier.toUpperCase()} tone={TIER_TONE[header.tier]} />
          {header.originalTier && header.originalTier !== header.tier && (
            <Badge
              label={`WAS ${header.originalTier.toUpperCase()}`}
              tone="text-[#6A6A6A] border-white/[0.10]"
            />
          )}
          <Badge label={statusLabel(header.status)} tone={STATUS_TONE[header.status]} />
          {header.isTest && (
            <Badge label="TEST MODE" tone="text-[#C4A868] border-[#C4A868]/40" />
          )}
        </div>
      </div>
    </header>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={`rounded-[4px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}
    >
      {label}
    </span>
  );
}
