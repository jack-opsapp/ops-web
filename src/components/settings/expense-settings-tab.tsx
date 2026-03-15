"use client";

import { useState, useEffect } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useExpenseSettings,
  useUpdateExpenseSettings,
  useAutoApproveRules,
  useToggleAutoApproveRule,
  useDeleteAutoApproveRule,
} from "@/lib/hooks";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { AutoApproveRuleType } from "@/lib/types/expense-approval";
import { AutoApproveRuleForm } from "@/components/expenses/auto-approve-rule-form";

type ReviewFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export function ExpenseSettingsTab() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { data: settings, isLoading } = useExpenseSettings();
  const updateSettings = useUpdateExpenseSettings();
  const { data: rules = [] } = useAutoApproveRules();
  const toggleRule = useToggleAutoApproveRule();
  const deleteRule = useDeleteAutoApproveRule();

  // Hooks must be called before any early return
  const [localAutoApprove, setLocalAutoApprove] = useState<string>("");
  const [localAdminApproval, setLocalAdminApproval] = useState<string>("");
  const [showAddRule, setShowAddRule] = useState(false);

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
    if (!can("expenses.configure")) return;
    updateSettings.mutate(
      { [key]: !currentValue },
      {
        onSuccess: () => toast.success(t("preferences.toast.settingUpdated")),
        onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
      }
    );
  }

  function handleThresholdBlur(key: "autoApproveThreshold" | "adminApprovalThreshold", value: string) {
    if (!can("expenses.configure")) return;
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card>
        <CardHeader>
          <CardTitle>{t("expenses.reviewFrequency")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {frequencies.map((freq) => (
              <button
                key={freq.id}
                disabled={!can("expenses.configure")}
                onClick={() => {
                  if (!can("expenses.configure")) return;
                  updateSettings.mutate(
                    { reviewFrequency: freq.id },
                    {
                      onSuccess: () => toast.success(`${t("expenses.toast.frequencySet")} ${freq.label}`),
                      onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
                    }
                  );
                }}
                className={cn(
                  "flex-1 px-3 py-2 rounded border text-center font-mohave text-body transition-all disabled:opacity-40 disabled:cursor-not-allowed",
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
                disabled={!can("expenses.configure")}
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
                disabled={!can("expenses.configure")}
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
              disabled={!can("expenses.configure")}
              onClick={() => handleToggle("requireReceiptPhoto", requireReceiptPhoto)}
              className={cn(
                "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
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
              disabled={!can("expenses.configure")}
              onClick={() => handleToggle("requireProjectAssignment", requireProjectAssignment)}
              className={cn(
                "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
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

      {/* Auto-Approve Rules — full width */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("expenses.autoApproveRules")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="font-kosugi text-[11px] text-text-disabled">
            {t("expenses.autoApproveRulesDesc")}
          </p>

          {/* Rules list */}
          {rules.length === 0 && !showAddRule && (
            <p className="font-kosugi text-caption-sm text-text-disabled py-2">
              {t("expenses.noRules")}
            </p>
          )}

          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between py-2 border-b border-border last:border-b-0"
            >
              <div className="flex items-center gap-2">
                {/* Rule type pill */}
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded font-kosugi text-[10px] uppercase tracking-wider",
                    rule.ruleType === AutoApproveRuleType.Invoice
                      ? "bg-[rgba(129,149,181,0.15)] text-[#8195B5]"
                      : "bg-[rgba(196,168,104,0.15)] text-[#C4A868]"
                  )}
                >
                  {rule.ruleType === AutoApproveRuleType.Invoice
                    ? t("expenses.ruleTypeInvoice")
                    : t("expenses.ruleTypeLineItem")}
                </span>

                {/* Threshold */}
                <span className="font-mono text-data-sm text-text-primary">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                  }).format(rule.thresholdAmount)}
                </span>

                {/* Members */}
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                  {rule.appliesToAll
                    ? t("expenses.allMembers")
                    : `${rule.members.length} ${t("expenses.members").toLowerCase()}`}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Active toggle */}
                <button
                  disabled={!can("expenses.configure")}
                  onClick={() => {
                    if (!can("expenses.configure")) return;
                    toggleRule.mutate(
                      { ruleId: rule.id, isActive: !rule.isActive },
                      {
                        onSuccess: () => toast.success(t("expenses.toast.ruleToggled")),
                        onError: () => toast.error(t("expenses.toast.error")),
                      }
                    );
                  }}
                  className={cn(
                    "w-[36px] h-[20px] rounded-full transition-colors relative shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
                    rule.isActive ? "bg-ops-accent" : "bg-background-elevated"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-[2px] w-[16px] h-[16px] rounded-full bg-white transition-all",
                      rule.isActive ? "right-[2px]" : "left-[2px]"
                    )}
                  />
                </button>

                {/* Delete */}
                <button
                  disabled={!can("expenses.configure")}
                  onClick={() => {
                    if (!can("expenses.configure")) return;
                    deleteRule.mutate(rule.id, {
                      onSuccess: () => toast.success(t("expenses.toast.ruleDeleted")),
                      onError: () => toast.error(t("expenses.toast.error")),
                    });
                  }}
                  className="text-text-disabled hover:text-[#93321A] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-disabled"
                >
                  <Trash2 className="w-[14px] h-[14px]" />
                </button>
              </div>
            </div>
          ))}

          {/* Add rule form */}
          {showAddRule ? (
            <AutoApproveRuleForm onClose={() => setShowAddRule(false)} />
          ) : (
            can("expenses.configure") && (
              <button
                onClick={() => setShowAddRule(true)}
                className="font-kosugi text-caption-sm text-ops-accent hover:text-text-primary uppercase tracking-wider transition-colors"
              >
                {t("expenses.addRule")}
              </button>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
