import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const syncSource = readFileSync(
  resolve(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);
const sendSource = readFileSync(
  resolve(process.cwd(), "src/app/api/integrations/email/send/route.ts"),
  "utf8"
);
const cronSource = readFileSync(
  resolve(process.cwd(), "src/app/api/cron/email-sync/route.ts"),
  "utf8"
);
const historyScanSource = readFileSync(
  resolve(
    process.cwd(),
    "src/app/api/integrations/ai-setup/email-scan/route.ts"
  ),
  "utf8"
);
const draftReconciliationSource = readFileSync(
  resolve(process.cwd(), "src/lib/api/services/draft-reconciliation.ts"),
  "utf8"
);
const draftFeedbackSource = readFileSync(
  resolve(
    process.cwd(),
    "src/app/api/integrations/email/draft-feedback/route.ts"
  ),
  "utf8"
);

describe("outbound learning producer and worker wiring", () => {
  it("repairs the durable sample on existing-activity replay and all new outbound paths", () => {
    const sentProcessor = syncSource.slice(
      syncSource.indexOf("async function processSentEmail("),
      syncSource.indexOf("async function learnFromOutboundEmail(")
    );
    const learningCall = sentProcessor.indexOf(
      "await learnFromOutboundEmail(email, connection, existingActivity)"
    );
    const replayBranch = sentProcessor.indexOf("if (existingActivity)");

    // Enqueue once before any ownership branch. This covers existing-activity
    // replay, linked sent mail, and unmatched sent mail without an early-return
    // loss window.
    expect(learningCall).toBeGreaterThan(-1);
    expect(learningCall).toBeLessThan(replayBranch);
    expect(
      sentProcessor.match(
        /await learnFromOutboundEmail\(email, connection, existingActivity\)/g
      )
    ).toHaveLength(1);
    expect(syncSource).toContain("new EmailOutboundLearningService(supabase)");
    expect(syncSource).toContain("enqueueIfEnabled");
    expect(syncSource).toContain(
      "draftDeliveryChannel: existingActivity?.draft_history_id"
    );
    expect(syncSource).toContain('? "ops_send"');
    expect(syncSource).toContain(
      "subject, body_text, draft_history_id, created_by"
    );
    expect(syncSource).toContain("hasAuthenticatedOpsActivity");
    expect(syncSource).toContain(
      "hasAuthenticatedOpsActivity && existingActivity?.subject != null"
    );
    expect(syncSource).toContain(
      "hasAuthenticatedOpsActivity && existingActivity?.body_text != null"
    );
    expect(syncSource).toContain("subject: canonicalDraftSubject");
    expect(syncSource).toContain("bodyText: canonicalDraftBody");
    expect(syncSource).toContain("authoredBody: canonicalAuthoredBody");
    expect(syncSource).toContain("stripRenderedEmailSignature({");
    expect(syncSource).not.toContain("hasPendingMailboxDraft");
    expect(syncSource).toMatch(
      /: hasAuthenticatedOpsActivity\s+\? "operator_authored"\s+: "autonomous"/
    );
    expect(syncSource).not.toContain("MemoryService.processOutboundEmail(");
    expect(syncSource).not.toContain("WritingProfileService.updateFromEmail(");
  });

  it("keeps manual provider delivery successful when enqueue fails and runs no inline learning effects", () => {
    expect(sendSource).toContain(
      "outbound learning enqueue failed after delivery"
    );
    expect(sendSource).toContain("enqueueIfEnabled");
    expect(sendSource).toContain("draftHistoryId");
    expect(sendSource).toContain("followUpDraftId");
    expect(sendSource).toContain("opportunityId: effectiveOpportunityId");
    expect(sendSource).not.toContain("AIDraftService.recordDraftOutcome(");
    expect(sendSource).not.toContain("recordLifecycleDraftOutcome(");
    expect(sendSource).not.toContain("MemoryService.processOutboundEmail(");
    expect(sendSource).not.toContain("WritingProfileService.updateFromEmail(");
  });

  it("drains a bounded worker from the existing cron without stopping sync loops", () => {
    expect(cronSource).toContain("runWorker({ limit: 10, concurrency: 2");
    expect(cronSource).toContain("outboundLearning");
    expect(cronSource).toContain("outboundLearningError");
  });

  it("routes repeatable history scans through provider-id receipts", () => {
    const postRoute = historyScanSource.slice(
      historyScanSource.indexOf("export async function POST"),
      historyScanSource.indexOf("// ─── Progress update helper")
    );
    const personalConnectionGuard = postRoute.indexOf(
      "if (!isPersonalHistoricalLearningConnection(connection, userId))"
    );
    const scanJobInsert = postRoute.indexOf('.from("gmail_scan_jobs")');

    expect(personalConnectionGuard).toBeGreaterThan(-1);
    expect(scanJobInsert).toBeGreaterThan(personalConnectionGuard);
    expect(postRoute).toContain(
      "Connect your own inbox to build your email profile."
    );
    expect(historyScanSource).toContain(
      "new EmailOutboundLearningService(supabase)"
    );
    expect(historyScanSource).toContain("providerMessageId: email.id");
    expect(historyScanSource).toContain(
      "prepareHistoricalOutboundBodyForLearning"
    );
    expect(historyScanSource).toContain(
      "if (!preparedBody.exactSignatureRemoved)"
    );
    expect(historyScanSource).toContain(
      "authoredBody: preparedBody.authoredBody"
    );
    expect(historyScanSource).toContain("cleanBody: preparedBody.cleanBody");
    expect(historyScanSource).toContain(
      'learningAuthority: "operator_authored"'
    );
    expect(historyScanSource).toContain("connection.companyId !== companyId");
    expect(historyScanSource).not.toContain(
      "WritingProfileService.updateFromEmail("
    );
    expect(historyScanSource).not.toContain(
      "MemoryService.processOutboundEmail("
    );
  });

  it("makes the queue the sole sent-outcome owner for native-mailbox drafts", () => {
    expect(draftReconciliationSource).toContain(
      "new EmailOutboundLearningService(supabase)"
    );
    expect(draftReconciliationSource).toContain(
      "draftHistoryId: row.id as string"
    );
    expect(draftReconciliationSource).not.toContain(
      "AIDraftService.recordDraftOutcome("
    );
    expect(draftReconciliationSource).not.toContain(
      '.update({ status: "sent_from_mailbox" })'
    );
    const freshReplyBranch = draftReconciliationSource.slice(
      draftReconciliationSource.indexOf('case "from_scratch"'),
      draftReconciliationSource.indexOf('case "discarded"')
    );
    expect(freshReplyBranch).toContain("enqueueIfEnabled");
    expect(freshReplyBranch).toContain(
      "learningAuthority: preparedBody.signatureRemoved"
    );
    expect(freshReplyBranch).toContain('? "operator_authored"');
  });

  it("rejects client-reported sent feedback so only confirmed delivery can train", () => {
    expect(draftFeedbackSource).toContain('if (outcome !== "discarded")');
    expect(draftFeedbackSource).not.toContain('outcome !== "sent"');
    expect(draftFeedbackSource).toContain('"discarded"');
  });
});
