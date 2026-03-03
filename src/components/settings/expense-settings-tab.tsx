"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useExpenseSettings, useUpdateExpenseSettings } from "@/lib/hooks";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

type ReviewFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export function ExpenseSettingsTab() {
  const { t } = useDictionary("settings");
  const { data: settings, isLoading } = useExpenseSettings();
  const updateSettings = useUpdateExpenseSettings();

  // Hooks must be called before any early return
  const [localAutoApprove, setLocalAutoApprove] = useState<string>("");
  const [localAdminApproval, setLocalAdminApproval] = useState<string>("");

  // Sync local state when settings load
  useEffect(() => {
    if (settings) {
      if (settings.autoApproveThreshold != null) {
        setLocalAutoApprove(String(settings.autoApproveThreshold));
      }
      if (settings.adminApprovalThreshold != null) {
        setLocalAdminApproval(String(settings.adminApprovalThreshold));
      }
    }
  }, [settings]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const reviewFrequency = settings?.reviewFrequency ?? "weekly";
  const autoApproveThreshold = settings?.autoApproveThreshold;
  const adminApprovalThreshold = settings?.adminApprovalThreshold;
  const requireReceiptPhoto = settings?.requireReceiptPhoto ?? true;
  const requireProjectAssignment = settings?.requireProjectAssignment ?? false;

  const frequencies: { id: ReviewFrequency; label: string }[] = [
    { id: "daily", label: t("expenses.daily") },
    { id: "weekly", label: t("expenses.weekly") },
    { id: "biweekly", label: t("expenses.biweekly") },
    { id: "monthly", label: t("expenses.monthly") },
  ];

  function handleToggle(key: "requireReceiptPhoto" | "requireProjectAssignment", currentValue: boolean) {
    updateSettings.mutate(
      { [key]: !currentValue },
      {
        onSuccess: () => toast.success(t("preferences.toast.settingUpdated")),
        onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
      }
    );
  }

  function handleThresholdBlur(key: "autoApproveThreshold" | "adminApprovalThreshold", value: string) {
    const num = value === "" ? null : parseFloat(value);
    if (value !== "" && (isNaN(num!) || num! < 0)) return;
    // Only save if value actually changed
    const currentValue = key === "autoApproveThreshold" ? autoApproveThreshold : adminApprovalThreshold;
    if (num === currentValue) return;
    updateSettings.mutate(
      { [key]: num },
      {
        onSuccess: () => toast.success(t("preferences.toast.settingUpdated")),
        onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
      }
    );
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>{t("expenses.reviewFrequency")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {frequencies.map((freq) => (
              <button
                key={freq.id}
                onClick={() => {
                  updateSettings.mutate(
                    { reviewFrequency: freq.id },
                    {
                      onSuccess: () => toast.success(`${t("expenses.toast.frequencySet")} ${freq.label}`),
                      onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
                    }
                  );
                }}
                className={cn(
                  "flex-1 px-3 py-2 rounded border text-center font-mohave text-body transition-all",
                  reviewFrequency === freq.id
                    ? "bg-ops-accent-muted border-ops-accent text-text-primary"
                    : "bg-background-input border-border text-text-secondary hover:border-border-medium"
                )}
              >
                {freq.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("expenses.thresholds")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text-primary">{t("expenses.autoApproveThreshold")}</p>
              <p className="font-kosugi text-[11px] text-text-disabled">{t("expenses.autoApproveDesc")}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="font-mohave text-body text-text-tertiary">$</span>
              <Input
                type="number"
                min={0}
                step={1}
                value={localAutoApprove}
                onChange={(e) => setLocalAutoApprove(e.target.value)}
                onBlur={() => handleThresholdBlur("autoApproveThreshold", localAutoApprove)}
                placeholder="—"
                className="w-[80px] h-[32px] text-center"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text-primary">{t("expenses.adminApprovalThreshold")}</p>
              <p className="font-kosugi text-[11px] text-text-disabled">{t("expenses.adminApprovalDesc")}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="font-mohave text-body text-text-tertiary">$</span>
              <Input
                type="number"
                min={0}
                step={1}
                value={localAdminApproval}
                onChange={(e) => setLocalAdminApproval(e.target.value)}
                onBlur={() => handleThresholdBlur("adminApprovalThreshold", localAdminApproval)}
                placeholder="—"
                className="w-[80px] h-[32px] text-center"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("expenses.requirements")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between py-[6px]">
            <div>
              <p className="font-mohave text-body text-text-primary">{t("expenses.requireReceipt")}</p>
              <p className="font-kosugi text-[11px] text-text-disabled">{t("expenses.requireReceiptDesc")}</p>
            </div>
            <button
              onClick={() => handleToggle("requireReceiptPhoto", requireReceiptPhoto)}
              className={cn(
                "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
                requireReceiptPhoto ? "bg-ops-accent" : "bg-background-elevated"
              )}
            >
              <span
                className={cn(
                  "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                  requireReceiptPhoto ? "right-[2px]" : "left-[2px]"
                )}
              />
            </button>
          </div>

          <div className="flex items-center justify-between py-[6px]">
            <div>
              <p className="font-mohave text-body text-text-primary">{t("expenses.requireProject")}</p>
              <p className="font-kosugi text-[11px] text-text-disabled">{t("expenses.requireProjectDesc")}</p>
            </div>
            <button
              onClick={() => handleToggle("requireProjectAssignment", requireProjectAssignment)}
              className={cn(
                "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
                requireProjectAssignment ? "bg-ops-accent" : "bg-background-elevated"
              )}
            >
              <span
                className={cn(
                  "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                  requireProjectAssignment ? "right-[2px]" : "left-[2px]"
                )}
              />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
