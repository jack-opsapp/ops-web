"use client";

import { useState, useEffect } from "react";
import { Loader2, Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/lib/hooks";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

type BooleanPrefKey =
  | "pushEnabled"
  | "emailEnabled"
  | "taskAssigned"
  | "taskCompleted"
  | "scheduleChanges"
  | "projectUpdates"
  | "expenseSubmitted"
  | "expenseApproved"
  | "invoiceSent"
  | "paymentReceived"
  | "teamMentions"
  | "dailyDigest";

interface ToggleRowProps {
  label: string;
  description?: string;
  enabled: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, description, enabled, onToggle }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between py-[6px]">
      <div>
        <p className="font-mohave text-body text-text-primary">{label}</p>
        {description && (
          <p className="font-kosugi text-[11px] text-text-disabled">{description}</p>
        )}
      </div>
      <button
        onClick={onToggle}
        className={cn(
          "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
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
  );
}

export function NotificationsTab() {
  const { t } = useDictionary("settings");
  const { data: prefs, isLoading } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  // Local state for quiet hours — saves on blur only
  const [localStart, setLocalStart] = useState(prefs?.quietHoursStart ?? "");
  const [localEnd, setLocalEnd] = useState(prefs?.quietHoursEnd ?? "");

  // Sync local state when server data loads/changes
  useEffect(() => {
    setLocalStart(prefs?.quietHoursStart ?? "");
    setLocalEnd(prefs?.quietHoursEnd ?? "");
  }, [prefs?.quietHoursStart, prefs?.quietHoursEnd]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
        </CardContent>
      </Card>
    );
  }

  function toggle(key: BooleanPrefKey) {
    const currentValue = prefs?.[key] ?? true;
    updatePrefs.mutate(
      { [key]: !currentValue },
      {
        onSuccess: () => toast.success(t("preferences.toast.settingUpdated")),
        onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
      }
    );
  }

  function saveQuietHours(key: "quietHoursStart" | "quietHoursEnd", value: string) {
    const currentValue = key === "quietHoursStart" ? prefs?.quietHoursStart : prefs?.quietHoursEnd;
    const newValue = value || null;
    if (newValue === (currentValue ?? null)) return; // No change
    updatePrefs.mutate(
      { [key]: newValue },
      { onSuccess: () => toast.success(t("preferences.toast.settingUpdated")) }
    );
  }

  const categoryItems: { key: BooleanPrefKey; labelKey: string }[] = [
    { key: "taskAssigned", labelKey: "notifications.taskAssigned" },
    { key: "taskCompleted", labelKey: "notifications.taskCompleted" },
    { key: "scheduleChanges", labelKey: "notifications.scheduleChanges" },
    { key: "projectUpdates", labelKey: "notifications.projectUpdates" },
    { key: "expenseSubmitted", labelKey: "notifications.expenseSubmitted" },
    { key: "expenseApproved", labelKey: "notifications.expenseApproved" },
    { key: "invoiceSent", labelKey: "notifications.invoiceSent" },
    { key: "paymentReceived", labelKey: "notifications.paymentReceived" },
    { key: "teamMentions", labelKey: "notifications.teamMentions" },
  ];

  // Quiet hours warning: both set but identical
  const quietHoursWarning = localStart && localEnd && localStart === localEnd;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Left column: Channels + Digest/Quiet Hours stacked */}
      <div className="space-y-3">
        {/* Global Channels */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="w-[16px] h-[16px] text-text-secondary" />
              <CardTitle>{t("notifications.channels")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <ToggleRow
              label={t("notifications.pushNotifications")}
              description={t("notifications.pushDesc")}
              enabled={prefs?.pushEnabled ?? true}
              onToggle={() => toggle("pushEnabled")}
            />
            <ToggleRow
              label={t("notifications.emailNotifications")}
              description={t("notifications.emailDesc")}
              enabled={prefs?.emailEnabled ?? true}
              onToggle={() => toggle("emailEnabled")}
            />
          </CardContent>
        </Card>

        {/* Digest & Quiet Hours */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BellOff className="w-[16px] h-[16px] text-text-secondary" />
              <CardTitle>{t("notifications.digestQuietHours")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <ToggleRow
              label={t("notifications.dailyDigest")}
              description={t("notifications.dailyDigestDesc")}
              enabled={prefs?.dailyDigest ?? false}
              onToggle={() => toggle("dailyDigest")}
            />

            <div className="py-[6px]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mohave text-body text-text-primary">{t("notifications.quietHours")}</p>
                  <p className="font-kosugi text-[11px] text-text-disabled">{t("notifications.quietHoursDesc")}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="time"
                    value={localStart}
                    onChange={(e) => setLocalStart(e.target.value)}
                    onBlur={() => saveQuietHours("quietHoursStart", localStart)}
                    className="bg-background-input border border-border rounded px-2 py-1 font-kosugi text-[11px] text-text-primary w-[90px]"
                  />
                  <span className="font-kosugi text-[11px] text-text-disabled">–</span>
                  <input
                    type="time"
                    value={localEnd}
                    onChange={(e) => setLocalEnd(e.target.value)}
                    onBlur={() => saveQuietHours("quietHoursEnd", localEnd)}
                    className="bg-background-input border border-border rounded px-2 py-1 font-kosugi text-[11px] text-text-primary w-[90px]"
                  />
                </div>
              </div>
              {quietHoursWarning && (
                <p className="font-kosugi text-[10px] text-yellow-400 mt-1">{t("notifications.quietHoursSameWarning")}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right column: Categories */}
      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.categories")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {categoryItems.map((item) => (
            <ToggleRow
              key={item.key}
              label={t(item.labelKey)}
              enabled={prefs?.[item.key] ?? true}
              onToggle={() => toggle(item.key)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
