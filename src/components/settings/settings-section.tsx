"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface SettingsSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function SettingsSection({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1.5 transition-colors duration-200",
          "hover:bg-[rgba(255,255,255,0.03)]",
          open && "border-b border-border"
        )}
      >
        <Icon className="w-[16px] h-[16px] text-text-tertiary shrink-0" />
        <span className="font-mohave text-body text-text-primary flex-1 text-left">
          {title}
        </span>
        <ChevronDown
          className={cn(
            "w-[16px] h-[16px] text-text-disabled transition-transform duration-300 ease-out",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "p-2 transition-opacity duration-300 ease-out",
              open ? "opacity-100" : "opacity-0"
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
