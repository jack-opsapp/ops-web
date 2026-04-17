"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Bell, BellOff, Smartphone, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/lib/hooks";
import type { EventType, ChannelPreferences } from "@/lib/api/services/notification-preferences-service";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Toggle Component ────────────────────────────────────────────────────────

interface ToggleSwitchProps {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  size?: "default" | "small";
}

function ToggleSwitch({ enabled, onToggle, disabled, size = "default" }: ToggleSwitchProps) {
  const isDefault = size === "default";
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "rounded-full transition-colors relative shrink-0",
        isDefault ? "w-[40px] h-[22px]" : "w-[32px] h-[18px]",
        disabled && "opacity-30 cursor-not-allowed",
        enabled ? "bg-text-2" : "bg-fill-neutral-dim"
      )}
    >
      <span
        className={cn(
          "absolute rounded-full bg-white transition-all",
          isDefault ? "top-[2px] w-[18px] h-[18px]" : "top-[2px] w-[14px] h-[14px]",
          enabled
            ? isDefault ? "right-[2px]" : "right-[2px]"
            : isDefault ? "left-[2px]" : "left-[2px]"
        )}
      />
    </button>
  );
}

// ─── Category Row Component ──────────────────────────────────────────────────

interface CategoryRowProps {
  label: string;
  description: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  globalPushOff: boolean;
  globalEmailOff: boolean;
  onTogglePush: () => void;
  onToggleEmail: () => void;
}

function CategoryRow({
  label,
  description,
  pushEnabled,
  emailEnabled,
  globalPushOff,
  globalEmailOff,
  onTogglePush,
  onToggleEmail,
}: CategoryRowProps) {
  return (
    <div className="flex items-center gap-3 py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0">
      {/* Label */}
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body text-text">{label}</p>
        <p className="font-mono text-micro text-text-mute leading-tight">{description}</p>
      </div>
      {/* Phone toggle */}
      <div className="w-[40px] flex justify-center">
        <ToggleSwitch
          enabled={pushEnabled}
          onToggle={onTogglePush}
          disabled={globalPushOff}
          size="small"
        />
      </div>
      {/* Email toggle */}
      <div className="w-[40px] flex justify-center">
        <ToggleSwitch
          enabled={emailEnabled}
          onToggle={onToggleEmail}
          disabled={globalEmailOff}
          size="small"
        />
      </div>
    </div>
  );
}

// ─── Category Configuration ──────────────────────────────────────────────────

interface CategoryConfig {
  key: EventType;
  labelKey: string;
  descKey: string;
}

const CATEGORIES: CategoryConfig[] = [
  { key: "project_updates", labelKey: "notifications.projectUpdates", descKey: "notifications.projectUpdatesDesc" },
  { key: "task_assigned", labelKey: "notifications.taskAssigned", descKey: "notifications.taskAssignedDesc" },
  { key: "task_completed", labelKey: "notifications.taskCompleted", descKey: "notifications.taskCompletedDesc" },
  { key: "schedule_changes", labelKey: "notifications.scheduleChanges", descKey: "notifications.scheduleChangesDesc" },
  { key: "team_mentions", labelKey: "notifications.teamMentions", descKey: "notifications.teamMentionsDesc" },
  { key: "expense_submitted", labelKey: "notifications.expenseSubmitted", descKey: "notifications.expenseSubmittedDesc" },
  { key: "expense_approved", labelKey: "notifications.expenseApproved", descKey: "notifications.expenseApprovedDesc" },
  { key: "invoice_sent", labelKey: "notifications.invoiceSent", descKey: "notifications.invoiceSentDesc" },
  { key: "payment_received", labelKey: "notifications.paymentReceived", descKey: "notifications.paymentReceivedDesc" },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export function NotificationsTab() {
  const { t } = useDictionary("settings");
  const { data: prefs, isLoading } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  // Local state for quiet hours — saves on blur only
  const [localStart, setLocalStart] = useState(prefs?.quietHoursStart ?? "");
  const [localEnd, setLocalEnd] = useState(prefs?.quietHoursEnd ?? "");

  useEffect(() => {
    setLocalStart(prefs?.quietHoursStart ?? "");
    setLocalEnd(prefs?.quietHoursEnd ?? "");
  }, [prefs?.quietHoursStart, prefs?.quietHoursEnd]);

  const toggleGlobal = useCallback(
    (key: "pushEnabled" | "emailEnabled") => {
      const currentValue = prefs?.[key] ?? true;
      updatePrefs.mutate(
        { [key]: !currentValue },
        {
          onSuccess: () => toast.success(t("preferences.toast.settingUpdated")),
          onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
        }
      );
    },
    [prefs, updatePrefs, t]
  );

  const toggleChannel = useCallback(
    (eventType: EventType, channel: "push" | "email") => {
      if (!prefs) return;
      const current = prefs.channelPreferences[eventType];
      const newValue = !current[channel];

      updatePrefs.mutate(
        {
          channelPreferences: {
            [eventType]: {
              ...current,
              [channel]: newValue,
            },
          } as Partial<ChannelPreferences>,
        },
        {
          onSuccess: () => toast.success(t("preferences.toast.settingUpdated")),
          onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
        }
      );
    },
    [prefs, updatePrefs, t]
  );

  const toggleDailyDigest = useCallback(() => {
    if (!prefs) return;
    const current = prefs.channelPreferences.daily_digest;
    updatePrefs.mutate(
      {
        channelPreferences: {
          daily_digest: { push: !current.push, email: !current.email },
        } as Partial<ChannelPreferences>,
      },
      {
        onSuccess: () => toast.success(t("preferences.toast.settingUpdated")),
        onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
      }
    );
  }, [prefs, updatePrefs, t]);

  function saveQuietHours(key: "quietHoursStart" | "quietHoursEnd", value: string) {
    const currentValue = key === "quietHoursStart" ? prefs?.quietHoursStart : prefs?.quietHoursEnd;
    const newValue = value || null;
    if (newValue === (currentValue ?? null)) return;
    updatePrefs.mutate(
      { [key]: newValue },
      { onSuccess: () => toast.success(t("preferences.toast.settingUpdated")) }
    );
  }

  if (isLoading || !prefs) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-[20px] h-[20px] text-text-2 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const globalPushOff = !prefs.pushEnabled;
  const globalEmailOff = !prefs.emailEnabled;
  const quietHoursWarning = localStart && localEnd && localStart === localEnd;

  return (
    <div className="space-y-3">
      {/* Global Kill Switches */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="w-[16px] h-[16px] text-text-2" />
            <CardTitle>{t("notifications.globalControls")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="flex items-center justify-between py-[6px]">
            <div className="flex items-center gap-2">
              <Smartphone className="w-[14px] h-[14px] text-text-3" />
              <div>
                <p className="font-mohave text-body text-text">{t("notifications.pushNotifications")}</p>
                <p className="font-mono text-micro text-text-mute">{t("notifications.pushDesc")}</p>
              </div>
            </div>
            <ToggleSwitch
              enabled={prefs.pushEnabled}
              onToggle={() => toggleGlobal("pushEnabled")}
            />
          </div>
          <div className="flex items-center justify-between py-[6px]">
            <div className="flex items-center gap-2">
              <Mail className="w-[14px] h-[14px] text-text-3" />
              <div>
                <p className="font-mohave text-body text-text">{t("notifications.emailNotifications")}</p>
                <p className="font-mono text-micro text-text-mute">{t("notifications.emailDesc")}</p>
              </div>
            </div>
            <ToggleSwitch
              enabled={prefs.emailEnabled}
              onToggle={() => toggleGlobal("emailEnabled")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-Category, Per-Channel Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.categories")}</CardTitle>
          <p className="font-mono text-micro text-text-mute">{t("notifications.categoriesDesc")}</p>
        </CardHeader>
        <CardContent>
          {/* Column headers */}
          <div className="flex items-center gap-3 pb-[6px] mb-[2px] border-b border-[rgba(255,255,255,0.08)]">
            <div className="flex-1" />
            <div className="w-[40px] flex justify-center">
              <div className="flex flex-col items-center gap-0.5">
                <Smartphone className={cn("w-[12px] h-[12px]", globalPushOff ? "text-text-mute" : "text-text-2")} />
                <span className={cn("font-mono text-micro uppercase", globalPushOff ? "text-text-mute" : "text-text-3")}>
                  {t("notifications.colPhone")}
                </span>
              </div>
            </div>
            <div className="w-[40px] flex justify-center">
              <div className="flex flex-col items-center gap-0.5">
                <Mail className={cn("w-[12px] h-[12px]", globalEmailOff ? "text-text-mute" : "text-text-2")} />
                <span className={cn("font-mono text-micro uppercase", globalEmailOff ? "text-text-mute" : "text-text-3")}>
                  {t("notifications.colEmail")}
                </span>
              </div>
            </div>
          </div>

          {/* Global off warnings */}
          {globalPushOff && (
            <p className="font-mono text-micro text-yellow-400/70 py-1">
              {t("notifications.globalOff").replace("{channel}", t("notifications.colPhone").toLowerCase())}
            </p>
          )}
          {globalEmailOff && (
            <p className="font-mono text-micro text-yellow-400/70 py-1">
              {t("notifications.globalOff").replace("{channel}", t("notifications.colEmail").toLowerCase())}
            </p>
          )}

          {/* Category rows */}
          {CATEGORIES.map((cat) => (
            <CategoryRow
              key={cat.key}
              label={t(cat.labelKey)}
              description={t(cat.descKey)}
              pushEnabled={prefs.channelPreferences[cat.key].push}
              emailEnabled={prefs.channelPreferences[cat.key].email}
              globalPushOff={globalPushOff}
              globalEmailOff={globalEmailOff}
              onTogglePush={() => toggleChannel(cat.key, "push")}
              onToggleEmail={() => toggleChannel(cat.key, "email")}
            />
          ))}
        </CardContent>
      </Card>

      {/* Digest & Quiet Hours */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BellOff className="w-[16px] h-[16px] text-text-2" />
            <CardTitle>{t("notifications.digestQuietHours")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between py-[6px]">
            <div>
              <p className="font-mohave text-body text-text">{t("notifications.dailyDigest")}</p>
              <p className="font-mono text-micro text-text-mute">{t("notifications.dailyDigestDesc")}</p>
            </div>
            <ToggleSwitch
              enabled={prefs.channelPreferences.daily_digest.email || prefs.channelPreferences.daily_digest.push}
              onToggle={toggleDailyDigest}
            />
          </div>

          <div className="py-[6px]">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mohave text-body text-text">{t("notifications.quietHours")}</p>
                <p className="font-mono text-micro text-text-mute">{t("notifications.quietHoursDesc")}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="time"
                  value={localStart}
                  onChange={(e) => setLocalStart(e.target.value)}
                  onBlur={() => saveQuietHours("quietHoursStart", localStart)}
                  className="bg-surface-input border border-border rounded px-2 py-1 font-mono text-[11px] text-text w-[90px]"
                />
                <span className="font-mono text-[11px] text-text-mute">–</span>
                <input
                  type="time"
                  value={localEnd}
                  onChange={(e) => setLocalEnd(e.target.value)}
                  onBlur={() => saveQuietHours("quietHoursEnd", localEnd)}
                  className="bg-surface-input border border-border rounded px-2 py-1 font-mono text-[11px] text-text w-[90px]"
                />
              </div>
            </div>
            {quietHoursWarning && (
              <p className="font-mono text-micro text-yellow-400 mt-1">{t("notifications.quietHoursSameWarning")}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
