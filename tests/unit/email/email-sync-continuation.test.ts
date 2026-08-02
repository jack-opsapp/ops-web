import { describe, expect, it } from "vitest";

import {
  encodeEmailSyncContinuation,
  isEmailSyncContinuationPending,
} from "@/lib/email/email-sync-continuation";

describe("email sync continuation state", () => {
  it("treats a bounded Gmail provider remainder as nonterminal", () => {
    const providerToken =
      'gmail:v1:{"startHistoryId":"100","pageToken":null,"finalHistoryId":"200","pendingMessageIds":["message-2"]}';

    expect(isEmailSyncContinuationPending(providerToken)).toBe(true);
  });

  it("treats pending lead summaries as nonterminal after provider catch-up", () => {
    const token = encodeEmailSyncContinuation({
      providerToken: "200",
      pendingLeadSummaryOpportunityIds: ["opportunity-1"],
    });

    expect(isEmailSyncContinuationPending(token)).toBe(true);
  });

  it("treats an ordinary terminal provider cursor as complete", () => {
    expect(isEmailSyncContinuationPending("200")).toBe(false);
    expect(
      isEmailSyncContinuationPending(
        'm365:v1:{"inboxDeltaLink":"inbox","sentDeltaLink":"sent"}'
      )
    ).toBe(false);
  });

  it("fails closed when an OPS continuation is malformed", () => {
    expect(() =>
      isEmailSyncContinuationPending("ops-email-sync:v1:not-json")
    ).toThrow("invalid JSON");
  });
});
