import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const draftReconciliationSource = readFileSync(
  resolve(process.cwd(), "src/lib/api/services/draft-reconciliation.ts"),
  "utf8"
);
const accuracySource = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/api/services/phase-c-draft-accuracy-service.ts"
  ),
  "utf8"
);
const graduationSource = readFileSync(
  resolve(process.cwd(), "src/app/api/cron/phase-c-graduation-check/route.ts"),
  "utf8"
);

describe("outbound-learning assignment runtime", () => {
  it("resolves mailbox-draft actors server-side immediately before enqueue", () => {
    expect(draftReconciliationSource).toContain(
      '"resolve_email_outbound_learning_mailbox_actor_as_system"'
    );
    expect(draftReconciliationSource).toContain("resolvedActor.actorUserId");
    expect(draftReconciliationSource).toContain("resolvedActor.opportunityId");
    expect(draftReconciliationSource).toContain(
      "p_provider_message_id: input.providerMessageId"
    );
    expect(draftReconciliationSource).toContain('outcome: "used"');
    expect(draftReconciliationSource).toContain('outcome: "from_scratch"');
  });

  it("does not train shared-mailbox fresh replies from a stale draft owner", () => {
    const freshReplyBranch = draftReconciliationSource.slice(
      draftReconciliationSource.indexOf('case "from_scratch"'),
      draftReconciliationSource.indexOf('case "discarded"')
    );
    expect(freshReplyBranch).toContain("if (resolvedActor)");
    expect(freshReplyBranch).toContain("userId: resolvedActor.actorUserId");
    expect(freshReplyBranch).not.toContain("userId: row.user_id as string");
  });

  it("reads calibration outcomes through a proof-filtered service RPC", () => {
    expect(accuracySource).toContain('"get_human_draft_accuracy_as_system"');
    expect(accuracySource).not.toContain(
      '.from("email_outbound_learning_queue")'
    );
  });

  it("enumerates graduation actors from the actor milestone ledger, never a connector owner", () => {
    expect(graduationSource).toContain(
      '"list_phase_c_graduation_actor_scopes_as_system"'
    );
    expect(graduationSource).not.toContain('.from("email_connections")');
    expect(graduationSource).not.toContain(
      '.select("id, company_id, user_id")'
    );
  });
});
