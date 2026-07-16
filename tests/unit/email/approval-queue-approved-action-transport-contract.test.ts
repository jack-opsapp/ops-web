import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const approvalQueue = readFileSync(
  join(process.cwd(), "src/lib/api/services/approval-queue-service.ts"),
  "utf8"
);
const autoExecuteRoute = readFileSync(
  join(process.cwd(), "src/app/api/cron/auto-execute-actions/route.ts"),
  "utf8"
);
const transport = readFileSync(
  join(
    process.cwd(),
    "src/lib/api/services/approved-action-email-transport-service.ts"
  ),
  "utf8"
);
const reconciliation = readFileSync(
  join(
    process.cwd(),
    "src/lib/api/services/approved-action-email-reconciliation-service.ts"
  ),
  "utf8"
);

describe("approval queue approved-action email transport contract", () => {
  it("does not call the browser email-send route from any queue executor", () => {
    expect(approvalQueue).not.toContain("/api/integrations/email/send");
    expect(approvalQueue).not.toContain("getAppUrl");
  });

  it("routes human-approved email actions through the persisted-action transport", () => {
    expect(approvalQueue).toContain(
      "ApprovedActionEmailTransportService.executeManual"
    );
    expect(approvalQueue).toContain("reviewed_by: userId");
  });

  it("uses a distinct autonomous execution method without forging reviewed_by", () => {
    expect(autoExecuteRoute).toContain("executeAutonomousAction(actionId)");
    expect(autoExecuteRoute).not.toContain("approveAction(");
    expect(autoExecuteRoute).not.toContain("learningAuthority");
  });

  it("authorizes persisted source rows before signature provider access", () => {
    expect(transport).not.toContain('.from("agent_actions")');
    expect(transport.indexOf("prepareAwaitingSignature")).toBeLessThan(
      transport.indexOf(
        "const signature = await resolveEmailSignatureForMessage"
      )
    );
  });

  it("allows provider-accepted recovery to reconcile after the mailbox is disabled", () => {
    expect(transport).toContain("requiresActiveMailbox");
    expect(transport).toContain(
      'requiresActiveMailbox && connection.status !== "active"'
    );
  });

  it("records autonomous sent-draft outcomes without treating them as human learning", () => {
    expect(reconciliation).toContain("if (intent.draftHistoryId)");
    expect(reconciliation).toContain(
      "learningAuthority: intent.learningAuthority"
    );
  });
});
