/**
 * Unit tests — bounded stranded-draft placement sweep
 *
 * The gap this closes: a Phase C draft whose mailbox placement failed is only
 * ever retried by the router, and the router only runs when the thread is
 * classified — which only happens when new inbound mail lands on that thread.
 * If the customer never writes again, the draft sits in OPS forever while the
 * operator's Drafts folder stays empty. That is what turned a one-afternoon
 * bug into a five-day outage.
 *
 * The sweep runs per connection on the sync cron whether or not any mail
 * arrived, is bounded at both ends (candidate rows, then threads), and can
 * never fail a sync.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { retryMock } = vi.hoisted(() => ({ retryMock: vi.fn() }));

vi.mock("@/lib/api/services/phase-c-autonomy-router", () => ({
  PhaseCAutonomyRouter: { retryStrandedMailboxDraft: retryMock },
}));

import {
  recoverStrandedPhaseCMailboxDraftsForConnection,
  PHASE_C_PLACEMENT_RECOVERY_THREAD_LIMIT,
} from "@/lib/api/services/phase-c-draft-placement-recovery";

interface Filter {
  table: string;
  method: string;
  args: unknown[];
}

function threadRow(providerThreadId: string, id: string) {
  return {
    id,
    company_id: "company-1",
    connection_id: "connection-1",
    provider_thread_id: providerThreadId,
    primary_category: "CUSTOMER",
    subject: "Front deck repair",
    labels: [],
    participants: ["steve@example.com"],
    first_message_at: "2026-08-05T10:00:00.000Z",
    last_message_at: "2026-08-06T02:05:00.000Z",
    latest_direction: "inbound",
    latest_sender_email: "steve@example.com",
    archived_at: null,
    snoozed_until: null,
    opportunity_id: "opportunity-1",
  };
}

function recoverySupabase(input: {
  candidates: Array<{ thread_id: string | null }>;
  threads?: Array<Record<string, unknown>>;
  historyError?: string;
}) {
  const filters: Filter[] = [];
  return {
    filters,
    supabase: {
      from(table: string) {
        const chain: Record<string, unknown> = {};
        // `lt` marks the age-out read, which scans older rows than the
        // placement candidate read and must not be served the same rows.
        let agingOut = false;
        for (const method of [
          "select",
          "eq",
          "not",
          "is",
          "gte",
          "lt",
          "in",
          "order",
          "update",
        ]) {
          chain[method] = (...args: unknown[]) => {
            filters.push({ table, method, args });
            if (method === "lt") agingOut = true;
            return chain;
          };
        }
        chain.limit = async () => ({
          data:
            table === "ai_draft_history"
              ? agingOut
                ? []
                : input.candidates
              : (input.threads ?? []),
          error:
            table === "ai_draft_history" && !agingOut && input.historyError
              ? { message: input.historyError }
              : null,
        });
        return chain;
      },
    } as never,
  };
}

const CONNECTION = { companyId: "company-1", connectionId: "connection-1" };

describe("recoverStrandedPhaseCMailboxDraftsForConnection", () => {
  beforeEach(() => {
    retryMock.mockReset();
    retryMock.mockResolvedValue({
      outcome: "auto_drafted",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
      detail: "provider-draft-1",
    });
  });

  it("does nothing when no draft is stranded", async () => {
    const { supabase } = recoverySupabase({ candidates: [] });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      ...CONNECTION,
      supabase,
    });

    expect(summary).toEqual({
      scanned: 0,
      placed: 0,
      skipped: 0,
      failed: 0,
      agedOut: 0,
    });
    expect(retryMock).not.toHaveBeenCalled();
  });

  it("re-drives placement for a stranded thread", async () => {
    const { supabase } = recoverySupabase({
      candidates: [{ thread_id: "provider-thread-1" }],
      threads: [threadRow("provider-thread-1", "thread-row-1")],
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      ...CONNECTION,
      supabase,
    });

    expect(summary).toMatchObject({ scanned: 1, placed: 1, failed: 0 });
    expect(retryMock).toHaveBeenCalledOnce();
    expect(retryMock.mock.calls[0][0]).toMatchObject({
      id: "thread-row-1",
      providerThreadId: "provider-thread-1",
      companyId: "company-1",
    });
  });

  it("leaves first-response outreach to the worker that owns it", async () => {
    // The contact-form draft worker also writes origin='phase_c' rows, and its
    // drafts start a NEW conversation, so they carry no thread_id and are
    // retried by that worker's own durable queue. Sweeping them here would put
    // two owners on one placement.
    const { supabase, filters } = recoverySupabase({ candidates: [] });

    await recoverStrandedPhaseCMailboxDraftsForConnection({
      ...CONNECTION,
      supabase,
    });

    const historyFilters = filters.filter(
      (entry) => entry.table === "ai_draft_history"
    );
    expect(historyFilters).toContainEqual(
      expect.objectContaining({ method: "eq", args: ["origin", "phase_c"] })
    );
    expect(historyFilters).toContainEqual(
      expect.objectContaining({ method: "eq", args: ["status", "drafted"] })
    );
    expect(historyFilters).toContainEqual(
      expect.objectContaining({
        method: "is",
        args: ["mailbox_draft_id", null],
      })
    );
    expect(historyFilters).toContainEqual(
      expect.objectContaining({ method: "not", args: ["thread_id", "is", null] })
    );
  });

  it("visits a thread once however many rows stranded on it", async () => {
    const { supabase } = recoverySupabase({
      candidates: [
        { thread_id: "provider-thread-1" },
        { thread_id: "provider-thread-1" },
        { thread_id: "provider-thread-1" },
      ],
      threads: [threadRow("provider-thread-1", "thread-row-1")],
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      ...CONNECTION,
      supabase,
    });

    expect(retryMock).toHaveBeenCalledOnce();
    expect(summary.scanned).toBe(1);
  });

  it("caps how many threads one cycle touches", async () => {
    const overflow = PHASE_C_PLACEMENT_RECOVERY_THREAD_LIMIT + 5;
    const candidates = Array.from({ length: overflow }, (_, index) => ({
      thread_id: `provider-thread-${index}`,
    }));
    const { supabase } = recoverySupabase({
      candidates,
      threads: candidates.map((candidate, index) =>
        threadRow(candidate.thread_id, `thread-row-${index}`)
      ),
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      ...CONNECTION,
      supabase,
    });

    expect(summary.scanned).toBe(PHASE_C_PLACEMENT_RECOVERY_THREAD_LIMIT);
    expect(retryMock.mock.calls.length).toBe(
      PHASE_C_PLACEMENT_RECOVERY_THREAD_LIMIT
    );
  });

  it("counts a fence that declined as skipped, not failed", async () => {
    retryMock.mockResolvedValue({
      outcome: "noop_not_inbound",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
    });
    const { supabase } = recoverySupabase({
      candidates: [{ thread_id: "provider-thread-1" }],
      threads: [threadRow("provider-thread-1", "thread-row-1")],
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      ...CONNECTION,
      supabase,
    });

    expect(summary).toMatchObject({ scanned: 1, placed: 0, skipped: 1, failed: 0 });
  });

  it("counts a still-pending placement as failed so it is retried", async () => {
    retryMock.mockResolvedValue({
      outcome: "draft_placement_pending",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
      detail: "PHASE_C_DRAFT_MAILBOX_BUSY",
    });
    const { supabase } = recoverySupabase({
      candidates: [{ thread_id: "provider-thread-1" }],
      threads: [threadRow("provider-thread-1", "thread-row-1")],
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      ...CONNECTION,
      supabase,
    });

    expect(summary).toMatchObject({ placed: 0, failed: 1 });
  });

  it("finishes the batch when one thread throws", async () => {
    retryMock
      .mockRejectedValueOnce(new Error("provider exploded"))
      .mockResolvedValue({
        outcome: "auto_drafted",
        category: "CUSTOMER",
        effectiveLevel: "auto_draft",
      });
    const { supabase } = recoverySupabase({
      candidates: [
        { thread_id: "provider-thread-1" },
        { thread_id: "provider-thread-2" },
      ],
      threads: [
        threadRow("provider-thread-1", "thread-row-1"),
        threadRow("provider-thread-2", "thread-row-2"),
      ],
    });

    const summary = await recoverStrandedPhaseCMailboxDraftsForConnection({
      ...CONNECTION,
      supabase,
    });

    expect(summary).toMatchObject({ scanned: 2, placed: 1, failed: 1 });
  });

  it("never throws, so a sync can never fail because of it", async () => {
    const { supabase } = recoverySupabase({
      candidates: [],
      historyError: "database unavailable",
    });

    await expect(
      recoverStrandedPhaseCMailboxDraftsForConnection({
        ...CONNECTION,
        supabase,
      })
    ).resolves.toMatchObject({ failed: 1 });
  });
});
