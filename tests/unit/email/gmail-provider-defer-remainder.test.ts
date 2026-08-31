import { describe, expect, it } from "vitest";

import { deferGmailBatchRemainder } from "@/lib/api/services/providers/gmail-provider";
import { isProviderSyncContinuationPending } from "@/lib/email/email-sync-continuation";

const GMAIL_CURSOR_PREFIX = "gmail:v1:";

function decodeStructuredCursor(token: string): {
  startHistoryId: string;
  pageToken: string | null;
  finalHistoryId: string;
  pendingMessageIds: string[];
} {
  expect(token.startsWith(GMAIL_CURSOR_PREFIX)).toBe(true);
  return JSON.parse(token.slice(GMAIL_CURSOR_PREFIX.length));
}

describe("deferGmailBatchRemainder", () => {
  it("turns a plain history token into a structured cursor owing the remainder", () => {
    const deferred = deferGmailBatchRemainder("998877", ["m-2", "m-3"]);

    expect(deferred).not.toBeNull();
    const cursor = decodeStructuredCursor(deferred as string);
    expect(cursor.startHistoryId).toBe("998877");
    expect(cursor.finalHistoryId).toBe("998877");
    expect(cursor.pageToken).toBeNull();
    expect(cursor.pendingMessageIds).toEqual(["m-2", "m-3"]);
    // The scheduler must read this as "provider work still owed" so the cycle
    // checkpoints instead of claiming a complete snapshot (bug 63ff8830).
    expect(isProviderSyncContinuationPending(deferred)).toBe(true);
  });

  it("unions the remainder with an existing pending set and preserves paging", () => {
    const existing = `${GMAIL_CURSOR_PREFIX}${JSON.stringify({
      startHistoryId: "1000",
      pageToken: "page-2",
      finalHistoryId: "1200",
      pendingMessageIds: ["m-9", "m-3"],
    })}`;

    const deferred = deferGmailBatchRemainder(existing, ["m-3", "m-4"]);

    const cursor = decodeStructuredCursor(deferred as string);
    expect(cursor.startHistoryId).toBe("1000");
    expect(cursor.pageToken).toBe("page-2");
    expect(cursor.finalHistoryId).toBe("1200");
    // Deduped, unprocessed-first — nothing is dropped and nothing is doubled.
    expect(cursor.pendingMessageIds).toEqual(["m-3", "m-4", "m-9"]);
  });

  it("returns the token untouched when nothing was left unprocessed", () => {
    expect(deferGmailBatchRemainder("998877", [])).toBe("998877");

    const structured = `${GMAIL_CURSOR_PREFIX}${JSON.stringify({
      startHistoryId: "1000",
      pageToken: null,
      finalHistoryId: "1200",
      pendingMessageIds: ["m-1"],
    })}`;
    expect(deferGmailBatchRemainder(structured, [])).toBe(structured);
  });

  it("returns null when the remainder exceeds the cursor's pending cap", () => {
    const tooMany = Array.from({ length: 2_001 }, (_, index) => `m-${index}`);

    expect(deferGmailBatchRemainder("998877", tooMany)).toBeNull();
  });

  it("returns null instead of throwing on a malformed cursor", () => {
    expect(deferGmailBatchRemainder(`${GMAIL_CURSOR_PREFIX}{not-json`, ["m-1"])).toBeNull();
    expect(
      deferGmailBatchRemainder(
        `${GMAIL_CURSOR_PREFIX}${JSON.stringify({
          startHistoryId: "1000",
          pageToken: null,
        })}`,
        ["m-1"]
      )
    ).toBeNull();
    expect(deferGmailBatchRemainder("", ["m-1"])).toBeNull();
    expect(deferGmailBatchRemainder("   ", ["m-1"])).toBeNull();
  });
});
