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
const approvalTypesSource = source("src/lib/types/approval-queue.ts");
const paymentReminderSource = source(
  "src/lib/api/services/payment-reminder-service.ts"
);
const schedulingCommsSource = source(
  "src/lib/api/services/client-scheduling-comms-service.ts"
);
const inboxHookSource = source("src/lib/hooks/use-inbox-threads.ts");
const inboxRouteSource = source("src/components/ops/inbox/inbox-route.tsx");

describe("internal email send draft provenance", () => {
  it("hands every approval-queue send to the durable draft-outcome owner", () => {
    const sendBlocks = [
      functionBlock(
        approvalQueueSource,
        "async function executeSendStatusEmail(",
        "async function executeReassignTask("
      ),
      functionBlock(
        approvalQueueSource,
        "async function executeSendInvoiceEmail(",
        "async function executeSendPaymentReminder("
      ),
      functionBlock(
        approvalQueueSource,
        "async function executeSendPaymentReminder(",
        "async function executeClientHealthAlert("
      ),
      functionBlock(
        approvalQueueSource,
        "async function sendClientCommsEmail(",
        "async function executeSendAppointmentConfirmation("
      ),
    ];

    for (const block of sendBlocks) {
      const ensureIndex = block.indexOf("ensureApprovalDraftHistory(");
      const sendIndex = block.indexOf("/api/integrations/email/send");

      expect(ensureIndex).toBeGreaterThan(-1);
      expect(sendIndex).toBeGreaterThan(ensureIndex);
      expect(block).toContain("draftHistoryId:");
    }

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

  it("lets the canonical send route own threaded activity persistence", () => {
    const clientCommsSend = functionBlock(
      approvalQueueSource,
      "async function sendClientCommsEmail(",
      "async function executeSendAppointmentConfirmation("
    );

    expect(clientCommsSend).toContain("threadId: params.threadId ?? null");
    expect(clientCommsSend).toContain(
      "opportunityId: params.opportunityId ?? null"
    );
    expect(clientCommsSend).not.toContain('.from("activities")');
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
