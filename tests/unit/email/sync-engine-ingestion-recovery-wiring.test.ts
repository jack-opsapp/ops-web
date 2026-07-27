import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

const applyLabelBody = source.slice(
  source.indexOf("async function applyLabel("),
  source.indexOf("/**", source.indexOf("async function applyLabel("))
);
const recoveryMethod = source.slice(
  source.indexOf("async retryPendingIngestionRecovery("),
  source.indexOf("async retryPendingLeadScans(")
);

describe("sync-engine durable ingestion recovery wiring", () => {
  it("persists an exact-message label intent before touching the provider", () => {
    const enqueue = applyLabelBody.indexOf("enqueueEmailIngestionRecovery({");
    const provider = applyLabelBody.indexOf("await provider.applyLabel(");
    expect(enqueue).toBeGreaterThan(-1);
    expect(applyLabelBody).toContain('kind: "provider_label_apply",');
    expect(applyLabelBody).toContain("providerMessageId: messageId,");
    expect(enqueue).toBeLessThan(provider);
  });

  it("persists provider failure for backoff and requires durable completion after acceptance", () => {
    expect(applyLabelBody).toContain("await failEmailIngestionRecovery({");
    expect(applyLabelBody).toContain('outcome: "label_applied",');
    expect(applyLabelBody).toContain(
      "provider label recovery completion changed"
    );
  });

  it("recovers the queued provider message, never the thread's latest inbound", () => {
    expect(recoveryMethod).toContain("message.email.id === providerMessageId");
    expect(recoveryMethod).not.toContain(".at(-1)");
    expect(recoveryMethod).toContain("processInboundEmail(");
    expect(recoveryMethod).toContain("persistAIClassifiedUnmatchedInbound({");
  });

  it("reauthorizes inside the mailbox lease and reuses normal safety policy", () => {
    const mailboxLease = recoveryMethod.indexOf(
      "async runWithMailboxLease(input)"
    );
    const reauthorize = recoveryMethod.indexOf(
      "reauthorize_email_ingestion_recovery_as_system"
    );
    expect(mailboxLease).toBeGreaterThan(-1);
    expect(reauthorize).toBeGreaterThan(-1);
    expect(recoveryMethod).toContain(
      "executionPolicy: NORMAL_EMAIL_INGESTION_POLICY,"
    );
    expect(recoveryMethod).toContain("recoveryActorUserId: null,");
  });
});
