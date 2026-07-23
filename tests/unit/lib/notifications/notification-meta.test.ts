import { describe, it, expect } from "vitest";
import {
  NOTIF_TYPE_META,
  resolveTone,
  lucideIconFromName,
  toneRank,
} from "@/lib/notifications/notification-meta";
import type { NotificationType } from "@/lib/api/services/notification-service";

const ALL_TYPES: NotificationType[] = [
  "mention",
  "role_needed",
  "pipeline_complete",
  "gmail_sync",
  "email_sync_complete",
  "email_signature_required",
  "intel_available",
  "setup_prompt",
  "leads_waiting",
  "lead_assigned",
  "lead_assignment_required",
  "system",
  "project_assigned",
  "lead_converted",
  "task_assigned",
  "task_completed",
  "schedule_change",
  "expense_submitted",
  "expense_approved",
  "expense_paid",
  "duplicates_found",
  "duplicates_merged",
  "data_review_resolved",
  "ai_milestone",
  "ai_provider_quota",
  "agent_suggestion",
  "trial_expiry",
  "payment_review_stack",
  "task_review_stack",
  "unscheduled_review_stack",
  "projects_needing_tasks",
  "accounting_import_complete",
  "accounting_sync",
];

describe("notification-meta", () => {
  it("maps every NotificationType to a complete meta entry", () => {
    expect(Object.keys(NOTIF_TYPE_META).sort()).toEqual([...ALL_TYPES].sort());
    for (const type of ALL_TYPES) {
      const meta = NOTIF_TYPE_META[type];
      expect(meta, `${type} should have meta`).toBeDefined();
      expect(meta.label).toMatch(/^[A-Z ]{2,}$/);
      expect(meta.icon).toMatch(/^[a-z0-9-]+$/);
      expect(["critical", "attn", "accent", "ambient"]).toContain(meta.tone);
    }
  });

  it("marks an ownerless lead as a critical assignment action", () => {
    expect(NOTIF_TYPE_META.lead_assignment_required).toEqual({
      label: "OWNER",
      icon: "user-plus",
      tone: "critical",
    });
  });

  it("assigns role_needed, duplicates_found, trial_expiry, accounting_sync to critical tone", () => {
    expect(NOTIF_TYPE_META.role_needed.tone).toBe("critical");
    expect(NOTIF_TYPE_META.duplicates_found.tone).toBe("critical");
    expect(NOTIF_TYPE_META.trial_expiry.tone).toBe("critical");
    expect(NOTIF_TYPE_META.accounting_sync.tone).toBe("critical");
  });

  it("assigns mention, intel, leads, schedule_change, expense_submitted to attn", () => {
    expect(NOTIF_TYPE_META.mention.tone).toBe("attn");
    expect(NOTIF_TYPE_META.intel_available.tone).toBe("attn");
    expect(NOTIF_TYPE_META.leads_waiting.tone).toBe("attn");
    expect(NOTIF_TYPE_META.schedule_change.tone).toBe("attn");
    expect(NOTIF_TYPE_META.expense_submitted.tone).toBe("attn");
  });

  it("resolveTone falls back to 'accent' for unknown types", () => {
    expect(resolveTone("not_a_real_type" as NotificationType)).toBe("accent");
  });

  it("toneRank orders critical > attn > accent > ambient", () => {
    expect(toneRank.critical).toBeGreaterThan(toneRank.attn);
    expect(toneRank.attn).toBeGreaterThan(toneRank.accent);
    expect(toneRank.accent).toBeGreaterThan(toneRank.ambient);
  });

  it("lucideIconFromName returns a component for every meta.icon", () => {
    for (const type of ALL_TYPES) {
      const iconName = NOTIF_TYPE_META[type].icon;
      const Icon = lucideIconFromName(iconName);
      expect(
        typeof Icon,
        `${iconName} should resolve to a Lucide component`
      ).toBe("object");
    }
  });

  it("lucideIconFromName returns Circle for unknown names", () => {
    const Icon = lucideIconFromName("nonexistent-icon");
    expect(Icon.displayName || Icon.name).toMatch(/Circle/i);
  });
});
