"use client";

import { Mail, MessageSquareText, Layers } from "lucide-react";
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

  const segments: Array<{
    value: ChannelFilter;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      value: "all",
      label: t("filter.all"),
      icon: <Layers className="w-[13px] h-[13px]" />,
    },
    {
      value: "email",
      label: t("filter.email"),
      icon: <Mail className="w-[13px] h-[13px]" />,
    },
    {
      value: "portal",
      label: t("filter.portal"),
      icon: <MessageSquareText className="w-[13px] h-[13px]" />,
    },
  ];

  return (
    <div className="inline-flex items-center gap-[8px] px-[6px] rounded-[4px] border border-border-subtle bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] saturate-[1.2] shrink-0">
      {segments.map((seg, i) => (
        <div key={seg.value} className="flex items-center gap-[8px]">
          {i > 0 && <div className="w-[1px] h-[18px] bg-border-subtle" />}
          <button
            onClick={() => onChange(seg.value)}
            className={cn(
              "flex items-center gap-[5px] px-[8px] py-[5px] rounded-sm transition-colors duration-150 cursor-pointer",
              active === seg.value
                ? "text-ops-accent bg-ops-accent-muted/20"
                : "text-text-3 hover:text-text hover:bg-surface-input"
            )}
          >
            {seg.icon}
            <span className="font-kosugi text-micro uppercase tracking-wider">
              {seg.label}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
