"use client";

import { useState } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanySettings, useUpdateCompanySettings } from "@/lib/hooks";
import { toast } from "sonner";

function LifecycleSettings() {
  const { data: settings, isLoading } = useCompanySettings();
  const updateSettings = useUpdateCompanySettings();

  function handleToggle(key: "autoGenerateTasks" | "gmailAutoLogEnabled", currentValue: boolean) {
    updateSettings.mutate(
      { [key]: !currentValue },
      {
        onSuccess: () => toast.success("Setting updated"),
        onError: (err) => toast.error("Failed to update", { description: err.message }),
      }
    );
  }

  function handleFollowUpDays(value: string) {
    const days = parseInt(value, 10);
    if (isNaN(days) || days < 1) return;
    updateSettings.mutate(
      { followUpReminderDays: days },
      {
        onSuccess: () => toast.success("Follow-up reminder updated"),
        onError: (err) => toast.error("Failed to update", { description: err.message }),
      }
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-4">
          <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const autoGenerate = settings?.autoGenerateTasks ?? false;
  const followUpDays = settings?.followUpReminderDays ?? 3;
  const gmailAutoLog = settings?.gmailAutoLogEnabled ?? true;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between py-[6px]">
          <div>
            <p className="font-mohave text-body text-text-primary">Auto-generate tasks</p>
            <p className="font-kosugi text-[11px] text-text-disabled">
              Skip the review modal and auto-create tasks when estimates are approved.
            </p>
          </div>
          <button
            onClick={() => handleToggle("autoGenerateTasks", autoGenerate)}
            className={cn(
              "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
              autoGenerate ? "bg-ops-accent" : "bg-background-elevated"
            )}
          >
            <span
              className={cn(
                "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                autoGenerate ? "right-[2px]" : "left-[2px]"
              )}
            />
          </button>
        </div>

        <div className="flex items-center justify-between py-[6px]">
          <div>
            <p className="font-mohave text-body text-text-primary">Follow-up reminder</p>
            <p className="font-kosugi text-[11px] text-text-disabled">
              Days after sending a quote before auto-creating a follow-up reminder.
            </p>
          </div>
          <div className="flex items-center gap-[6px] shrink-0">
            <Input
              type="number"
              min={1}
              max={30}
              value={followUpDays}
              onChange={(e) => handleFollowUpDays(e.target.value)}
              className="w-[56px] h-[32px] text-center"
            />
            <span className="font-mohave text-body-sm text-text-tertiary">days</span>
          </div>
        </div>

        <div className="flex items-center justify-between py-[6px]">
          <div>
            <p className="font-mohave text-body text-text-primary">Gmail auto-log</p>
            <p className="font-kosugi text-[11px] text-text-disabled">
              Automatically log emails from connected Gmail accounts to deal timelines.
            </p>
          </div>
          <button
            onClick={() => handleToggle("gmailAutoLogEnabled", gmailAutoLog)}
            className={cn(
              "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
              gmailAutoLog ? "bg-ops-accent" : "bg-background-elevated"
            )}
          >
            <span
              className={cn(
                "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                gmailAutoLog ? "right-[2px]" : "left-[2px]"
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

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
      <LifecycleSettings />

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
