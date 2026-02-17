"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function PreferencesTab() {
  const [dashboardLayout, setDashboardLayout] = useState<"default" | "compact" | "data-dense">("default");
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, boolean>>({
    "Task assignments": true,
    "Project updates": true,
    "Team activity": true,
    "Sync alerts": false,
    "Client messages": true,
    "Schedule changes": true,
    "Invoice reminders": false,
    "Pipeline movement": true,
  });

  const layouts = [
    { id: "default" as const, label: "Default", description: "Balanced overview with cards" },
    { id: "compact" as const, label: "Compact", description: "More items, less detail" },
    { id: "data-dense" as const, label: "Data Dense", description: "Maximum information density" },
  ];

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard Layout</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {layouts.map((layout) => (
              <button
                key={layout.id}
                onClick={() => setDashboardLayout(layout.id)}
                className={cn(
                  "w-full flex items-center justify-between px-1.5 py-1 rounded border transition-all",
                  dashboardLayout === layout.id
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-background-input border-border hover:border-border-medium"
                )}
              >
                <div>
                  <p className="font-mohave text-body text-text-primary text-left">{layout.label}</p>
                  <p className="font-kosugi text-[11px] text-text-tertiary">{layout.description}</p>
                </div>
                {dashboardLayout === layout.id && (
                  <div className="w-[20px] h-[20px] rounded-full bg-ops-accent flex items-center justify-center">
                    <Check className="w-[12px] h-[12px] text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {Object.entries(notificationPrefs).map(([item, enabled]) => (
            <div key={item} className="flex items-center justify-between py-[6px]">
              <span className="font-mohave text-body text-text-secondary">{item}</span>
              <button
                onClick={() => {
                  const newValue = !enabled;
                  setNotificationPrefs((prev) => ({ ...prev, [item]: newValue }));
                  toast.success(`${item} notifications ${newValue ? "enabled" : "disabled"}`);
                }}
                className={cn(
                  "w-[40px] h-[22px] rounded-full transition-colors relative",
                  enabled ? "bg-ops-accent" : "bg-background-elevated"
                )}
              >
                <span
                  className={cn(
                    "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                    enabled ? "right-[2px]" : "left-[2px]"
                  )}
                />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
