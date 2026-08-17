import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("provider delivery source runtime fence", () => {
  it("captures every provider-backed inbound and outbound message before sync can create an activity", () => {
    const syncEngine = source("src/lib/api/services/sync-engine.ts");
    const inboundStart = syncEngine.indexOf(
      "async function processInboundEmail"
    );
    const sentStart = syncEngine.indexOf("async function processSentEmail");
    const inbound = syncEngine.slice(inboundStart, sentStart);
    const sent = syncEngine.slice(sentStart);

    expect(inbound).toContain("captureProviderDeliveryBeforeMutableIngest");
    expect(sent).toContain("captureProviderDeliveryBeforeMutableIngest");
    expect(inbound).toContain(
      'withAuthoritativeProviderDeliveryTimestamp(\n    normalizedEmail,\n    "inbound"'
    );
    expect(sent).toContain(
      'withAuthoritativeProviderDeliveryTimestamp(\n    normalizedEmail,\n    "outbound"'
    );
    expect(syncEngine).toContain("source.providerReceivedAt");
    expect(syncEngine).toContain("source.providerSentAt");
    expect(syncEngine).toContain("captureProviderDeliveredEmailSource");
    expect(syncEngine).toContain("persistCapturedProviderDeliveryTurn");
    const eventAt = syncEngine.indexOf(
      "await OpportunityLifecycleService.recordCorrespondenceEvent"
    );
    const turnAt = syncEngine.indexOf(
      "await persistCapturedProviderDeliveryTurn",
      eventAt
    );
    expect(turnAt).toBeGreaterThan(eventAt);
  });

  it("captures the immutable rendered provider payload before either accepted-send activity insert", () => {
    for (const [path, intentKind] of [
      [
        "src/lib/api/services/email-send-reconciliation-service.ts",
        "email_send_intent",
      ],
      [
        "src/lib/api/services/approved-action-email-reconciliation-service.ts",
        "approved_action_email_intent",
      ],
    ] as const) {
      const reconciliation = source(path);
      const captureAt = reconciliation.indexOf(
        "await captureAcceptedOutboundProviderDeliverySource"
      );
      const activityAt = reconciliation.indexOf('.from("activities")');

      expect(captureAt).toBeGreaterThan(-1);
      expect(activityAt).toBeGreaterThan(captureAt);
      const captureCall = reconciliation.slice(
        captureAt,
        reconciliation.indexOf("  });", captureAt) + 5
      );
      expect(captureCall).toContain("renderedBody: intent.renderedBody");
      expect(captureCall).toContain(
        "renderedBodyHash: intent.renderedBodyHash"
      );
      expect(captureCall).toContain(`outboundIntentKind: "${intentKind}"`);
      expect(captureCall).toContain("outboundIntentId: intent.id");
      expect(captureCall).not.toContain("authoredBody");
      const turnAt = reconciliation.indexOf(
        "await persistCapturedProviderDeliveryTurn"
      );
      const correspondenceAt = reconciliation.indexOf(
        "await OpportunityLifecycleService.recordCorrespondenceEvent"
      );
      expect(turnAt).toBeGreaterThan(correspondenceAt);
    }
  });
});
