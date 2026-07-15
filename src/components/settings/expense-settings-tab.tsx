"use client";

import { useState, useEffect } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SegmentControl } from "@/components/ui/segment-control";
import { Tag } from "@/components/ui/tag";
import { Card, CardContent } from "@/components/ui/card";
import {
  useExpenseSettings,
  useUpdateExpenseSettings,
  useAutoApproveRules,
  useToggleAutoApproveRule,
  useDeleteAutoApproveRule,
} from "@/lib/hooks";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { AutoApproveRuleType } from "@/lib/types/expense-approval";
import { AutoApproveRuleForm } from "@/components/expenses/auto-approve-rule-form";

type ReviewFrequency = "daily" | "weekly" | "biweekly" | "monthly";

// ─── Section header (canonical `// TITLE`) ──────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

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
          <Loader2 className="w-[20px] h-[20px] text-text-2 animate-spin" />
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
        <div className="pb-2">
          <SectionLabel>{t("expenses.reviewFrequency")}</SectionLabel>
        </div>
        <CardContent>
          <div className={cn(!can("expenses.configure") && "opacity-40 pointer-events-none")}>
            <SegmentControl
              options={frequencies.map((freq) => ({ value: freq.id, label: freq.label }))}
              value={reviewFrequency}
              onChange={(id) => {
                if (!can("expenses.configure")) return;
                const freq = frequencies.find((f) => f.id === id);
                updateSettings.mutate(
                  { reviewFrequency: id },
                  {
                    onSuccess: () =>
                      toast.success(`${t("expenses.toast.frequencySet")} ${freq?.label ?? id}`),
                    onError: (err) =>
                      toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
                  }
                );
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="pb-2">
          <SectionLabel>{t("expenses.thresholds")}</SectionLabel>
        </div>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text">{t("expenses.autoApproveThreshold")}</p>
              <p className="font-mono text-[11px] text-text-mute">{t("expenses.autoApproveDesc")}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="font-mohave text-body text-text-3">$</span>
              <Input
                type="number"
                min={0}
                step={1}
                value={localAutoApprove}
                onChange={(e) => setLocalAutoApprove(e.target.value)}
                onBlur={() => handleThresholdBlur("autoApproveThreshold", localAutoApprove)}
                placeholder="—"
                disabled={!can("expenses.configure")}
                className="w-[96px] text-center"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text">{t("expenses.adminApprovalThreshold")}</p>
              <p className="font-mono text-[11px] text-text-mute">{t("expenses.adminApprovalDesc")}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="font-mohave text-body text-text-3">$</span>
              <Input
                type="number"
                min={0}
                step={1}
                value={localAdminApproval}
                onChange={(e) => setLocalAdminApproval(e.target.value)}
                onBlur={() => handleThresholdBlur("adminApprovalThreshold", localAdminApproval)}
                placeholder="—"
                disabled={!can("expenses.configure")}
                className="w-[96px] text-center"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="pb-2">
          <SectionLabel>{t("expenses.requirements")}</SectionLabel>
        </div>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between gap-4 py-[6px]">
            <div className="min-w-0">
              <p className="font-mohave text-body text-text">{t("expenses.requireReceipt")}</p>
              <p className="font-mono text-[11px] text-text-mute">{t("expenses.requireReceiptDesc")}</p>
            </div>
            <Switch
              checked={requireReceiptPhoto}
              disabled={!can("expenses.configure")}
              onCheckedChange={() => handleToggle("requireReceiptPhoto", requireReceiptPhoto)}
              className="shrink-0"
            />
          </div>

          <div className="flex items-center justify-between gap-4 py-[6px]">
            <div className="min-w-0">
              <p className="font-mohave text-body text-text">{t("expenses.requireProject")}</p>
              <p className="font-mono text-[11px] text-text-mute">{t("expenses.requireProjectDesc")}</p>
            </div>
            <Switch
              checked={requireProjectAssignment}
              disabled={!can("expenses.configure")}
              onCheckedChange={() => handleToggle("requireProjectAssignment", requireProjectAssignment)}
              className="shrink-0"
            />
          </div>
        </CardContent>
      </Card>

      {/* Auto-Approve Rules — full width */}
      <Card className="lg:col-span-2">
        <div className="pb-2">
          <SectionLabel>{t("expenses.autoApproveRules")}</SectionLabel>
        </div>
        <CardContent className="space-y-2">
          <p className="font-mono text-[11px] text-text-mute">
            {t("expenses.autoApproveRulesDesc")}
          </p>

          {/* Rules list */}
          {rules.length === 0 && !showAddRule && (
            <p className="font-mono text-caption-sm text-text-mute py-2">
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
                <Tag variant="tan">
                  {rule.ruleType === AutoApproveRuleType.Invoice
                    ? t("expenses.ruleTypeInvoice")
                    : t("expenses.ruleTypeLineItem")}
                </Tag>

                {/* Threshold */}
                <span className="font-mono text-data-sm text-text tabular-nums">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                  }).format(rule.thresholdAmount)}
                </span>

                {/* Members */}
                <span className="font-mono text-micro text-text-3 uppercase tracking-wider tabular-nums">
                  {rule.appliesToAll
                    ? t("expenses.allMembers")
                    : `${rule.members.length} ${t("expenses.members").toLowerCase()}`}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Active toggle */}
                <Switch
                  checked={rule.isActive}
                  disabled={!can("expenses.configure")}
                  onCheckedChange={() => {
                    if (!can("expenses.configure")) return;
                    toggleRule.mutate(
                      { ruleId: rule.id, isActive: !rule.isActive },
                      {
                        onSuccess: () => toast.success(t("expenses.toast.ruleToggled")),
                        onError: () => toast.error(t("expenses.toast.error")),
                      }
                    );
                  }}
                  className="shrink-0"
                />

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
                  className="text-text-mute hover:text-rose transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-mute"
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
                className="font-mono text-caption-sm text-text-2 hover:text-text uppercase tracking-wider transition-colors"
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
