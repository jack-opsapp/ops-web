"use client";

import { useState, useEffect } from "react";
import { Plus, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  EmailFilterRule,
  EmailFilterField,
  EmailFilterOperator,
  GmailSyncFilters,
} from "@/lib/types/pipeline";

// ─── Constants ───────────────────────────────────────────────────────────────

const FIELD_OPTIONS: { value: EmailFilterField; label: string }[] = [
  { value: "subject", label: "Subject" },
  { value: "from_email", label: "Sender email" },
  { value: "from_domain", label: "Sender domain" },
  { value: "label", label: "Gmail label" },
  { value: "body", label: "Email body" },
];

const OPERATOR_OPTIONS: { value: EmailFilterOperator; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
];

const LABEL_OPERATORS: { value: EmailFilterOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
];

const PLACEHOLDER_MAP: Record<EmailFilterField, string> = {
  subject: "e.g. New Form Submission",
  from_email: "e.g. leads@mywebsite.com",
  from_domain: "e.g. mywebsite.com",
  label: "Select a label",
  body: "e.g. inquiry",
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface EmailFilterBuilderProps {
  filters: GmailSyncFilters;
  connectionId: string;
  onUpdate: (filters: GmailSyncFilters) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EmailFilterBuilder({
  filters,
  connectionId,
  onUpdate,
}: EmailFilterBuilderProps) {
  const rules = filters.rules ?? [];
  const logic = filters.ruleLogic ?? "all";
  const [gmailLabels, setGmailLabels] = useState<{ id: string; name: string }[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);

  // Fetch Gmail labels when component mounts or a label field is selected
  useEffect(() => {
    if (!connectionId) return;
    const hasLabelRule = rules.some((r) => r.field === "label");
    if (hasLabelRule && gmailLabels.length === 0 && !labelsLoading) {
      fetchLabels();
    }
  }, [connectionId, rules.length]);

  async function fetchLabels() {
    setLabelsLoading(true);
    try {
      const resp = await fetch(
        `/api/integrations/gmail/labels?connectionId=${encodeURIComponent(connectionId)}`,
      );
      if (resp.ok) {
        const data = await resp.json();
        setGmailLabels(data.labels ?? []);
      }
    } catch {
      // Silently fail — labels are optional
    } finally {
      setLabelsLoading(false);
    }
  }

  function addRule() {
    const newRule: EmailFilterRule = {
      id: crypto.randomUUID(),
      field: "subject",
      operator: "contains",
      value: "",
    };
    onUpdate({ ...filters, rules: [...rules, newRule] });
  }

  function removeRule(id: string) {
    onUpdate({ ...filters, rules: rules.filter((r) => r.id !== id) });
  }

  function updateRule(id: string, updates: Partial<EmailFilterRule>) {
    const updated = rules.map((r) => {
      if (r.id !== id) return r;
      const merged = { ...r, ...updates };
      // Reset operator when switching to/from label field
      if (updates.field === "label" && r.field !== "label") {
        merged.operator = "equals";
        merged.value = "";
      } else if (updates.field && updates.field !== "label" && r.field === "label") {
        merged.operator = "contains";
        merged.value = "";
      }
      return merged;
    });
    onUpdate({ ...filters, rules: updated });

    // Fetch labels if a label field was just selected
    if (updates.field === "label" && gmailLabels.length === 0) {
      fetchLabels();
    }
  }

  function toggleLogic() {
    onUpdate({ ...filters, ruleLogic: logic === "all" ? "any" : "all" });
  }

  const hasRules = rules.length > 0;

  return (
    <div className="space-y-[8px]">
      {/* Logic toggle — only show when 2+ rules */}
      {rules.length >= 2 && (
        <div className="flex items-center gap-[6px]">
          <span className="font-kosugi text-[10px] text-text-disabled">
            Match
          </span>
          <button
            onClick={toggleLogic}
            className="inline-flex items-center gap-[3px] px-[8px] py-[3px] rounded-sm border border-border bg-background-input font-kosugi text-[11px] text-text-secondary hover:border-ops-accent hover:text-ops-accent transition-colors"
          >
            {logic === "all" ? "ALL" : "ANY"}
            <ChevronDown className="w-[10px] h-[10px]" />
          </button>
          <span className="font-kosugi text-[10px] text-text-disabled">
            of these rules
          </span>
        </div>
      )}

      {/* Rule rows */}
      {rules.map((rule, index) => (
        <div key={rule.id} className="flex items-start gap-[4px]">
          {/* Connector label */}
          {index > 0 && (
            <span className="shrink-0 pt-[7px] font-kosugi text-[9px] text-text-disabled uppercase w-[24px] text-right">
              {logic === "all" ? "and" : "or"}
            </span>
          )}
          {index === 0 && rules.length > 1 && (
            <span className="shrink-0 w-[24px]" />
          )}

          {/* Rule builder row */}
          <div className="flex-1 flex flex-wrap items-center gap-[4px] p-[6px] bg-[rgba(89,119,148,0.04)] border border-border rounded">
            {/* Field selector */}
            <select
              value={rule.field}
              onChange={(e) =>
                updateRule(rule.id, { field: e.target.value as EmailFilterField })
              }
              className="bg-background-input border border-border rounded px-[8px] py-[4px] font-kosugi text-[11px] text-text-primary min-w-0"
            >
              {FIELD_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>

            {/* Operator selector */}
            <select
              value={rule.operator}
              onChange={(e) =>
                updateRule(rule.id, { operator: e.target.value as EmailFilterOperator })
              }
              className="bg-background-input border border-border rounded px-[8px] py-[4px] font-kosugi text-[11px] text-text-primary min-w-0"
            >
              {(rule.field === "label" ? LABEL_OPERATORS : OPERATOR_OPTIONS).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* Value input — label gets a dropdown, others get text input */}
            {rule.field === "label" ? (
              <select
                value={rule.value}
                onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                className="flex-1 min-w-[120px] bg-background-input border border-border rounded px-[8px] py-[4px] font-kosugi text-[11px] text-text-primary"
              >
                <option value="">
                  {labelsLoading ? "Loading labels..." : "Select label"}
                </option>
                {gmailLabels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={rule.value}
                onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                placeholder={PLACEHOLDER_MAP[rule.field]}
                className="flex-1 min-w-[120px] bg-background-input border border-border rounded px-[8px] py-[4px] font-mono text-[11px] text-text-primary placeholder:text-text-disabled"
              />
            )}

            {/* Remove button */}
            <button
              onClick={() => removeRule(rule.id)}
              className="shrink-0 p-[2px] rounded hover:bg-[rgba(255,100,100,0.1)] text-text-disabled hover:text-ops-error transition-colors"
              title="Remove rule"
            >
              <X className="w-[14px] h-[14px]" />
            </button>
          </div>
        </div>
      ))}

      {/* Add rule button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={addRule}
        className="gap-[4px] font-kosugi text-[11px] text-text-disabled hover:text-ops-accent"
      >
        <Plus className="w-[12px] h-[12px]" />
        Add filter rule
      </Button>

      {/* Explanation */}
      {hasRules && (
        <p className="font-kosugi text-[10px] text-text-disabled leading-relaxed">
          {logic === "all"
            ? "Only emails matching ALL rules above will be imported/synced."
            : "Emails matching ANY of the rules above will be imported/synced."}
        </p>
      )}
    </div>
  );
}
