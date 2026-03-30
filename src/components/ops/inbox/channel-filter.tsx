"use client";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { ChannelFilter } from "@/lib/types/unified-inbox";

interface ChannelFilterProps {
  active: ChannelFilter;
  onChange: (filter: ChannelFilter) => void;
}

export function ChannelFilterBar({ active, onChange }: ChannelFilterProps) {
  const { t } = useDictionary("inbox");
  const can = usePermissionStore((s) => s.can);

  const canViewEmail = can("pipeline.view");
  const canViewPortal = can("portal.view");

  // If user only has one permission, no picker needed
  if (!canViewEmail || !canViewPortal) return null;

  const segments: Array<{ value: ChannelFilter; label: string }> = [
    { value: "all", label: t("filter.all") },
    { value: "email", label: t("filter.email") },
    { value: "portal", label: t("filter.portal") },
  ];

  return (
    <div className="px-3.5 py-1.5 border-b border-border-subtle bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] saturate-[1.2] sticky top-0 z-10">
      <div className="inline-flex bg-background-input border border-border-subtle rounded-[3px] overflow-hidden">
        {segments.map((seg) => (
          <button
            key={seg.value}
            onClick={() => onChange(seg.value)}
            className={cn(
              "px-3.5 py-1.5 font-kosugi text-micro uppercase tracking-[0.5px] border-b-2 transition-colors",
              active === seg.value
                ? "text-white bg-ops-accent-muted border-b-ops-accent"
                : "text-text-disabled bg-transparent border-b-transparent hover:text-text-tertiary"
            )}
          >
            {seg.label}
          </button>
        ))}
      </div>
    </div>
  );
}
