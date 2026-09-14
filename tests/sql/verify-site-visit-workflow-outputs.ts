import { readFileSync } from "node:fs";
import {
  SiteVisitWorkflowProposalSchema,
  SiteVisitWorkflowReceiptSchema,
} from "../../src/lib/agent-control-plane/contracts/site-visit-workflow";
import { verifySiteVisitTimezoneProof } from "../../src/lib/agent-control-plane/services/site-visit-workflow/civil-time";
import { assertSiteVisitReceiptBinding } from "../../src/lib/agent-control-plane/contracts/site-visit-workflow-binding";
const lines = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .filter(Boolean);
if (!lines.length) throw new Error("No real SQL outputs to verify");
const counts: Record<string, number> = {};
const proposals = new Map(
  lines
    .map((line) => JSON.parse(line))
    .filter((row) => row.kind === "proposal")
    .map((row) => [
      row.change_set_id,
      SiteVisitWorkflowProposalSchema.parse(row.payload),
    ])
);
for (const line of lines) {
  const { kind, payload } = JSON.parse(line);
  if (kind === "timezone") {
    verifySiteVisitTimezoneProof(payload);
    counts.timezone = (counts.timezone ?? 0) + 1;
    continue;
  }
  if (!["proposal", "receipt"].includes(kind))
    throw new Error("Unknown SQL output kind");
  const result = (
    kind === "proposal"
      ? SiteVisitWorkflowProposalSchema
      : SiteVisitWorkflowReceiptSchema
  ).safeParse(payload);
  if (!result.success)
    throw new Error(
      `${kind} ${payload.operation}: ${JSON.stringify(result.error.issues)}`
    );
  if (payload.timezone_proof)
    verifySiteVisitTimezoneProof(payload.timezone_proof);
  if (kind === "receipt") {
    const receipt = SiteVisitWorkflowReceiptSchema.parse(payload);
    const proposal = proposals.get(receipt.change_set_id);
    if (!proposal)
      throw new Error("Missing approved proposal for actual receipt");
    assertSiteVisitReceiptBinding(receipt, proposal, {
      actorUserId: receipt.actor_user_id,
      companyId: receipt.company_id,
      actionId: receipt.action_id,
      changeSetId: receipt.change_set_id,
      previewSha256: receipt.preview_sha256,
    });
  }
  counts[`${kind}:${payload.operation}`] =
    (counts[`${kind}:${payload.operation}`] ?? 0) + 1;
}
for (const kind of ["proposal", "receipt"])
  for (const op of [
    "book",
    "reschedule",
    "create_template",
    "edit_template",
    "select_checklist",
    "answer_form",
    "cancel",
  ]) {
    if (!counts[`${kind}:${op}`])
      throw new Error(`Missing real database proof: ${kind}:${op}`);
  }
if (counts.timezone !== 8)
  throw new Error("Missing actual PostgreSQL timezone output");
console.log(JSON.stringify({ verified: lines.length, counts }, null, 2));
