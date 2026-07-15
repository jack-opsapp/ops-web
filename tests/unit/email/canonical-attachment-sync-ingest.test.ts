import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [
    {
      id: "activity-new",
      email_message_id: "message-new",
      email_thread_id: "thread-1",
    },
    {
      id: "activity-inline-false-negative",
      email_message_id: "message-inline",
      email_thread_id: "thread-1",
    },
  ],
  filters: [] as Array<[string, unknown]>,
  ingestExact: vi.fn(),
}));

const supabase = {
  from: vi.fn(() => {
    const query: Record<string, unknown> = {};
    Object.assign(query, {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => {
        state.filters.push([column, value]);
        return query;
      }),
      not: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      then: (
        resolve: (result: { data: typeof state.rows; error: null }) => unknown
      ) => Promise.resolve({ data: state.rows, error: null }).then(resolve),
    });
    return query;
  }),
};

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => supabase,
}));

vi.mock("@/lib/api/services/email-attachments/attachment-runtime", () => ({
  ingestExactActivityAttachments: state.ingestExact,
}));

import { ingestAndInspectThreadAttachments } from "@/lib/api/services/conversation-state/attachment-ingest";

const connection = {
  id: "connection-1",
  companyId: "company-1",
  email: "operator@example.com",
} as never;

beforeEach(() => {
  state.filters.length = 0;
  state.ingestExact.mockReset();
  state.ingestExact.mockResolvedValue({ requiresRetry: false });
  supabase.from.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sync-time canonical attachment ingestion", () => {
  it("keeps provider copying and vision inspection outside cursor-critical sync", () => {
    const syncEngine = readFileSync(
      resolve(process.cwd(), "src/lib/api/services/sync-engine.ts"),
      "utf8"
    );

    expect(syncEngine).not.toMatch(/ingestAndInspectThreadAttachments/);
  });

  it("ingests recent inbound activities by exact mailbox/message identity without trusting has_attachments", async () => {
    await ingestAndInspectThreadAttachments({
      connection,
      providerThreadId: "thread-1",
      companyId: "company-1",
    });

    expect(state.filters).toEqual(
      expect.arrayContaining([
        ["company_id", "company-1"],
        ["email_connection_id", "connection-1"],
        ["email_thread_id", "thread-1"],
        ["direction", "inbound"],
        ["type", "email"],
      ])
    );
    expect(state.filters).not.toContainEqual(["has_attachments", true]);
    expect(state.ingestExact).toHaveBeenCalledTimes(2);
    expect(state.ingestExact).toHaveBeenNthCalledWith(
      1,
      supabase,
      connection,
      {
        companyId: "company-1",
        connectionId: "connection-1",
        activityId: "activity-new",
        messageId: "message-new",
      },
      { inspectImmediately: true }
    );
    expect(state.ingestExact).toHaveBeenNthCalledWith(
      2,
      supabase,
      connection,
      {
        companyId: "company-1",
        connectionId: "connection-1",
        activityId: "activity-inline-false-negative",
        messageId: "message-inline",
      },
      { inspectImmediately: true }
    );
  });

  it("keeps one failed attachment scan non-fatal while processing the rest", async () => {
    state.ingestExact
      .mockRejectedValueOnce(new Error("transient provider failure"))
      .mockResolvedValueOnce({ requiresRetry: false });

    await expect(
      ingestAndInspectThreadAttachments({
        connection,
        providerThreadId: "thread-1",
        companyId: "company-1",
      })
    ).resolves.toBeUndefined();

    expect(state.ingestExact).toHaveBeenCalledTimes(2);
  });
});
