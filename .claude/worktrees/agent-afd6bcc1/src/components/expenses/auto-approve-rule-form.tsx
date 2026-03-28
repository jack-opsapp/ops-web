"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { useCreateAutoApproveRule, useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { AutoApproveRuleType } from "@/lib/types/expense-approval";
import { useDictionary } from "@/i18n/client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AutoApproveRuleFormProps {
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AutoApproveRuleForm({ onClose }: AutoApproveRuleFormProps) {
  const { t } = useDictionary("settings");
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? "";

  const { data: teamData } = useTeamMembers();
  const teamMembers = teamData?.users ?? [];
  const createRule = useCreateAutoApproveRule();

  // Form state
  const [ruleType, setRuleType] = useState<AutoApproveRuleType>(
    AutoApproveRuleType.LineItem
  );
  const [threshold, setThreshold] = useState("");
  const [appliesToAll, setAppliesToAll] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const handleSubmit = () => {
    const amount = parseFloat(threshold);
    if (isNaN(amount) || amount <= 0) return;

    createRule.mutate(
      {
        rule: {
          companyId,
          createdBy: userId,
          ruleType,
          thresholdAmount: amount,
          appliesToAll,
        },
        memberIds: appliesToAll ? [] : selectedMembers,
      },
      {
        onSuccess: () => {
          toast.success(t("expenses.toast.ruleCreated"));
          onClose();
        },
        onError: () => toast.error(t("expenses.toast.error")),
      }
    );
  };

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const canSubmit =
    parseFloat(threshold) > 0 && (appliesToAll || selectedMembers.length > 0);

  return (
    <div className="border border-border rounded p-3 space-y-3 bg-[rgba(255,255,255,0.02)]">
      {/* Rule type picker */}
      <div>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block mb-1.5">
          {t("expenses.ruleType")}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setRuleType(AutoApproveRuleType.Invoice)}
            className={cn(
              "flex-1 px-3 py-2 rounded border text-left transition-all",
              ruleType === AutoApproveRuleType.Invoice
                ? "border-[#597794] bg-[rgba(89,119,148,0.08)]"
                : "border-border hover:border-[rgba(255,255,255,0.20)]"
            )}
          >
            <span className="font-mohave text-body-sm text-text-primary uppercase block">
              {t("expenses.ruleTypeInvoice")}
            </span>
            <span className="font-kosugi text-[10px] text-text-disabled">
              {t("expenses.ruleTypeInvoiceDesc")}
            </span>
          </button>
          <button
            onClick={() => setRuleType(AutoApproveRuleType.LineItem)}
            className={cn(
              "flex-1 px-3 py-2 rounded border text-left transition-all",
              ruleType === AutoApproveRuleType.LineItem
                ? "border-[#597794] bg-[rgba(89,119,148,0.08)]"
                : "border-border hover:border-[rgba(255,255,255,0.20)]"
            )}
          >
            <span className="font-mohave text-body-sm text-text-primary uppercase block">
              {t("expenses.ruleTypeLineItem")}
            </span>
            <span className="font-kosugi text-[10px] text-text-disabled">
              {t("expenses.ruleTypeLineItemDesc")}
            </span>
          </button>
        </div>
      </div>

      {/* Threshold amount */}
      <div>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block mb-1.5">
          {t("expenses.threshold")}
        </span>
        <div className="flex items-center gap-1">
          <span className="font-mohave text-body text-text-tertiary">$</span>
          <Input
            type="number"
            min={0}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="0.00"
            className="w-[120px] h-[32px]"
          />
        </div>
      </div>

      {/* Member assignment */}
      <div>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block mb-1.5">
          {t("expenses.members")}
        </span>

        {/* Applies to all toggle */}
        <div className="flex items-center justify-between py-1.5">
          <span className="font-kosugi text-caption-sm text-text-secondary">
            {t("expenses.appliesToAll")}
          </span>
          <button
            onClick={() => setAppliesToAll(!appliesToAll)}
            className={cn(
              "w-[36px] h-[20px] rounded-full transition-colors relative shrink-0",
              appliesToAll ? "bg-ops-accent" : "bg-background-elevated"
            )}
          >
            <span
              className={cn(
                "absolute top-[2px] w-[16px] h-[16px] rounded-full bg-white transition-all",
                appliesToAll ? "right-[2px]" : "left-[2px]"
              )}
            />
          </button>
        </div>

        {/* Member list (when not applies to all) */}
        {!appliesToAll && (
          <div className="max-h-[160px] overflow-y-auto space-y-0.5 mt-1.5 border border-border rounded p-2">
            {teamMembers.map((member) => (
              <label
                key={member.id}
                className="flex items-center gap-2 py-1 cursor-pointer hover:bg-[rgba(255,255,255,0.02)] rounded px-1"
              >
                <input
                  type="checkbox"
                  checked={selectedMembers.includes(member.id)}
                  onChange={() => toggleMember(member.id)}
                  className="w-[14px] h-[14px] rounded border-border accent-ops-accent"
                />
                <span className="font-kosugi text-caption-sm text-text-secondary">
                  {member.firstName} {member.lastName}
                </span>
              </label>
            ))}
            {teamMembers.length === 0 && (
              <span className="font-kosugi text-[10px] text-text-disabled">
                No team members found
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded border border-border text-text-tertiary hover:text-text-secondary font-kosugi text-caption-sm uppercase tracking-wider transition-colors"
        >
          {t("expenses.cancelRule")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || createRule.isPending}
          className={cn(
            "px-3 py-1.5 rounded font-kosugi text-caption-sm uppercase tracking-wider transition-colors flex items-center gap-1.5",
            canSubmit
              ? "bg-[rgba(157,181,130,0.15)] text-[#9DB582] hover:bg-[rgba(157,181,130,0.25)]"
              : "bg-[rgba(255,255,255,0.04)] text-text-disabled cursor-not-allowed"
          )}
        >
          {createRule.isPending && (
            <Loader2 className="w-[12px] h-[12px] animate-spin" />
          )}
          {t("expenses.saveRule")}
        </button>
      </div>
    </div>
  );
}
