"use client";

import { Plus, UserPlus, FileText, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

interface QuickActionsWidgetProps {
  size: WidgetSize;
  onNavigate: (path: string) => void;
}

const actions = [
  { label: "New Project", icon: Plus, path: "/projects" },
  { label: "New Client", icon: UserPlus, path: "/clients" },
  { label: "Create Invoice", icon: FileText, path: "/invoices" },
  { label: "Schedule Task", icon: CalendarPlus, path: "/calendar" },
];

export function QuickActionsWidget({ size, onNavigate }: QuickActionsWidgetProps) {
  const isCompact = size === "md";

  return (
    <div>
      {!isCompact && (
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest mb-1 block">
          Quick Actions
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <Button
            key={action.path}
            variant="ghost"
            className={isCompact ? "gap-0 px-1.5" : "gap-1.5"}
            onClick={() => onNavigate(action.path)}
            title={isCompact ? action.label : undefined}
          >
            <action.icon className="w-[16px] h-[16px]" />
            {!isCompact && action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
