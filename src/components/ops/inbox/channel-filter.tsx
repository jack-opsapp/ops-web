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
    <div className="px-3.5 py-1.5 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(10,10,10,0.9)] backdrop-blur-[12px] sticky top-0 z-10">
      <div className="inline-flex bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-[3px] overflow-hidden">
        {segments.map((seg) => (
          <button
            key={seg.value}
            onClick={() => onChange(seg.value)}
            className={cn(
              "px-3.5 py-1 font-kosugi text-micro-xs uppercase tracking-[0.5px] border-b-2 transition-colors",
              active === seg.value
                ? "text-white bg-[rgba(89,119,148,0.2)] border-b-[#597794]"
                : "text-[rgba(255,255,255,0.35)] bg-transparent border-b-transparent hover:text-[rgba(255,255,255,0.5)]"
            )}
          >
            {seg.label}
          </button>
        ))}
      </div>
    </div>
  );
}
