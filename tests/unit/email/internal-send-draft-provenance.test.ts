import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function functionBlock(
  contents: string,
  startMarker: string,
  endMarker: string
): string {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(start);
  return contents.slice(start, end);
}

const approvalQueueSource = source(
  "src/lib/api/services/approval-queue-service.ts"
);
const approvedActionTransportSource = source(
  "src/lib/api/services/approved-action-email-transport-service.ts"
);
const approvedActionReconciliationSource = source(
  "src/lib/api/services/approved-action-email-reconciliation-service.ts"
);
const approvalTypesSource = source("src/lib/types/approval-queue.ts");
const paymentReminderSource = source(
  "src/lib/api/services/payment-reminder-service.ts"
);
const schedulingCommsSource = source(
  "src/lib/api/services/client-scheduling-comms-service.ts"
);
const connectionSelectionSource = source(
  "src/lib/email/email-connection-selection.ts"
);
const inboxHookSource = source("src/lib/hooks/use-inbox-threads.ts");
const inboxRouteSource = source("src/components/ops/inbox/inbox-route.tsx");

describe("internal email send draft provenance", () => {
  it("selects only the actor's personal mailbox or a company mailbox for a new conversation", () => {
    expect(connectionSelectionSource).toContain('.eq("type", input.type)');
    expect(connectionSelectionSource).toContain('type: "individual"');
    expect(connectionSelectionSource).toContain(
      '.eq("user_id", input.actorUserId)'
    );
    expect(connectionSelectionSource).toContain('type: "company"');
    expect(connectionSelectionSource).toMatch(
      /\.eq\("status",\s*"active"\)/
    );
    expect(connectionSelectionSource).not.toContain("deleted_at");
    expect(connectionSelectionSource).not.toContain("is_active");
    expect(schedulingCommsSource).toContain(
      "resolveNewEmailConversationConnectionId"
    );
  });

  it("hands every approval-queue send to the durable draft-outcome owner", () => {
    expect(approvalQueueSource).toContain(
      "ApprovedActionEmailTransportService.executeManual"
    );
    expect(approvalQueueSource).not.toContain("/api/integrations/email/send");
    expect(approvalQueueSource).not.toContain(
      "AIDraftService.recordDraftOutcome("
    );
  });

  it("retains generated history IDs on every approval email action", () => {
    expect(paymentReminderSource).toContain("draft_history_id: draftHistoryId");
    expect(
      schedulingCommsSource.match(/draft_history_id: draftHistoryId/g)
    ).toHaveLength(5);
    expect(
      approvalTypesSource.match(/draft_history_id: string \| null;/g)
    ).toHaveLength(8);
  });

  it("lets durable approved-action reconciliation own activity persistence", () => {
    expect(approvedActionTransportSource).toContain(
      "reconcileApprovedActionEmail"
    );
    expect(approvedActionReconciliationSource).toContain('.from("activities")');
    expect(approvalQueueSource).not.toContain('.from("activities")');
  });

  it("passes inbox AI and lifecycle identities through the shared reply hook", () => {
    const replyArgs = functionBlock(
      inboxHookSource,
      "export interface SendReplyArgs",
      "export interface SendReplyResponse"
    );
    const sendMutation = inboxHookSource.slice(
      inboxHookSource.indexOf("export function useSendReply()")
    );
    const sendThreadReply = functionBlock(
      inboxRouteSource,
      "const sendThreadReply = useCallback(",
      "const composerErrorAccessory"
    );

    expect(replyArgs).toContain("draftHistoryId?: string | null");
    expect(replyArgs).toContain("followUpDraftId?: string | null");
    expect(sendMutation).toContain(
      "draftHistoryId: args.payload.draftHistoryId ?? null"
    );
    expect(sendMutation).toContain(
      "followUpDraftId: args.payload.followUpDraftId ?? null"
    );
    expect(sendThreadReply).toContain(
      'draftHistoryId: draft?.source === "ai" ? draft.id : null'
    );
    expect(sendThreadReply).toMatch(
      /followUpDraftId:\s*draft\?\.source === "lifecycle" \? draft\.id : null/
    );
  });
});
