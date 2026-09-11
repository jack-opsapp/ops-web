import type { z } from "zod-v4";
import {
  SiteVisitWorkflowReceiptSchema,
  type SiteVisitWorkflowProposal,
} from "./site-visit-workflow";

export function sameSiteVisitJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameSiteVisitJson(v, b[i]))
    );
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (k) => Object.hasOwn(right, k) && sameSiteVisitJson(left[k], right[k])
    )
  );
}
function normalizedAnswer(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...value } as Record<string, unknown>;
  if (Array.isArray(copy.artifactIds) && !copy.artifactIds.length)
    delete copy.artifactIds;
  return copy;
}
/** Match the saved business rows to the exact reviewed proposal, independently
 * of transport replay and action readback. PostgreSQL verifies its own hashes. */
export function assertSiteVisitReceiptBinding(
  receipt: z.infer<typeof SiteVisitWorkflowReceiptSchema>,
  proposal: SiteVisitWorkflowProposal,
  identity: {
    actorUserId: string;
    companyId: string;
    actionId: string;
    changeSetId: string;
    previewSha256: string;
  }
) {
  const invalid = () => {
    throw new Error("Site visit save receipt is invalid");
  };
  if (
    receipt.actor_user_id !== identity.actorUserId ||
    receipt.company_id !== identity.companyId ||
    receipt.action_id !== identity.actionId ||
    receipt.change_set_id !== identity.changeSetId ||
    receipt.preview_sha256 !== identity.previewSha256 ||
    receipt.operation !== proposal.operation ||
    !sameSiteVisitJson(receipt.appointment, proposal.appointment ?? null) ||
    !sameSiteVisitJson(receipt.timezone_proof, proposal.timezone_proof) ||
    !sameSiteVisitJson(receipt.effects, proposal.effects) ||
    !sameSiteVisitJson(receipt.missing_required, proposal.missing_required) ||
    receipt.records.length !== proposal.effects.records ||
    new Set(receipt.records.map((r) => r.id)).size !== receipt.records.length ||
    (proposal.operation !== "book" &&
      receipt.site_visit_id !== proposal.site_visit_id)
  )
    invalid();
  for (const row of receipt.records) {
    if (row.after.company_id !== identity.companyId || row.after.id !== row.id)
      invalid();
    if (proposal.entity === "appointment") {
      const a = proposal.appointment;
      if (
        !a ||
        row.entity !== "site_visit" ||
        receipt.records.length !== 1 ||
        row.id !== receipt.site_visit_id ||
        row.after.opportunity_id !== proposal.opportunity_id ||
        row.after.status !== proposal.effects.appointment_status ||
        Date.parse(String(row.after.scheduled_at)) !==
          Date.parse(a.starts_at) ||
        row.after.duration_minutes !== a.duration_minutes ||
        !sameSiteVisitJson(row.after.assignee_ids, a.assignee_ids) ||
        row.after.reminder_lead_minutes !== a.reminder_lead_minutes ||
        typeof row.after.booked_at !== "string"
      )
        invalid();
    } else {
      const expected = proposal.rows.find((r) => r.id === row.id);
      if (
        !expected ||
        row.entity !== proposal.entity ||
        !sameSiteVisitJson(row.before, expected.before) ||
        (proposal.entity === "answer" &&
          row.after.site_visit_id !== proposal.site_visit_id)
      )
        invalid();
      if (
        expected &&
        Object.entries(expected.values).some(
          ([key, value]) =>
            !sameSiteVisitJson(
              key === "answer_value" ? normalizedAnswer(value) : value,
              key === "answer_value"
                ? normalizedAnswer(row.after[key])
                : row.after[key]
            )
        )
      )
        invalid();
    }
  }
}
