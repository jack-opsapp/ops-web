import { describe, expect, it } from "vitest";

import {
  encodeEmailSyncContinuation,
  isEmailSyncContinuationPending,
  isProviderSyncContinuationPending,
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
        `m365:v2:${JSON.stringify({
          folderDeltaLink:
            "https://graph.microsoft.com/v1.0/me/mailFolders/delta?$deltatoken=folders-current",
          messageDeltaLinks: {
            inbox:
              "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=inbox-current",
          },
          pendingFolderIds: [],
        })}`
      )
    ).toBe(false);
  });

  it("separates provider catch-up from derived summary continuation work", () => {
    const providerPending =
      'gmail:v1:{"startHistoryId":"100","pageToken":null,"finalHistoryId":"200","pendingMessageIds":["message-2"]}';
    const summariesPending = encodeEmailSyncContinuation({
      providerToken: "200",
      pendingLeadSummaryOpportunityIds: ["opportunity-1"],
    });

    expect(isProviderSyncContinuationPending(providerPending)).toBe(true);
    expect(isProviderSyncContinuationPending(summariesPending)).toBe(false);
    expect(isProviderSyncContinuationPending("200")).toBe(false);
  });

  it("keeps Microsoft 365 provider work pending across both pagination layers", () => {
    const folderPagePending = `m365:v2:${JSON.stringify({
      folderDeltaLink:
        "https://graph.microsoft.com/v1.0/me/mailFolders/delta?$skiptoken=folder-page-2",
      messageDeltaLinks: {},
      pendingFolderIds: [],
    })}`;
    const messageFolderPending = `m365:v2:${JSON.stringify({
      folderDeltaLink:
        "https://graph.microsoft.com/v1.0/me/mailFolders/delta?$deltatoken=folders-current",
      messageDeltaLinks: {
        archive:
          "https://graph.microsoft.com/v1.0/me/mailFolders/archive/messages/delta?$skiptoken=message-page-2",
      },
      pendingFolderIds: ["archive"],
    })}`;

    expect(isProviderSyncContinuationPending(folderPagePending)).toBe(true);
    expect(isProviderSyncContinuationPending(messageFolderPending)).toBe(true);
    expect(
      isProviderSyncContinuationPending(
        'm365:v1:{"inboxDeltaLink":"inbox","sentDeltaLink":"sent"}'
      )
    ).toBe(true);
  });

  it("fails closed when a Microsoft 365 provider cursor is malformed", () => {
    expect(() =>
      isProviderSyncContinuationPending(
        'm365:v2:{"folderDeltaLink":"https://attacker.example/?$deltatoken=x","messageDeltaLinks":{},"pendingFolderIds":[]}'
      )
    ).toThrow("escaped Microsoft Graph");
  });

  it("fails closed when an OPS continuation is malformed", () => {
    expect(() =>
      isEmailSyncContinuationPending("ops-email-sync:v1:not-json")
    ).toThrow("invalid JSON");
  });
});
