/**
 * ApprovalQueueService.getQueue — the HISTORY view's multi-status filter.
 *
 * NEEDS YOU (status = pending) keeps the priority-then-newest sort. HISTORY
 * (every other status) is chronological by review time, so the in-app priority
 * re-sort must not run for it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (value: unknown) => (value ? new Date(value as string) : null),
}));

import { ApprovalQueueService } from "../approval-queue-service";
import { HISTORY_STATUSES } from "@/lib/agent-queue/status-filter";

const companyId = "44444444-4444-4444-8444-444444444444";

function row(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    company_id: companyId,
    user_id: "55555555-5555-4555-8555-555555555555",
    action_type: "reassign_task",
    action_data: {},
    context_summary: "context",
    context_source: null,
    source_id: null,
    confidence: 0.9,
    priority: "normal",
    status: "pending",
    created_at: "2026-08-31T20:00:00.000Z",
    updated_at: "2026-08-31T20:00:00.000Z",
    ...overrides,
  };
}

function fakeSupabase(rows: Record<string, unknown>[]) {
  const calls = {
    eq: [] as unknown[][],
    in: [] as unknown[][],
    order: [] as unknown[][],
    limit: [] as unknown[][],
  };

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((...args: unknown[]) => {
      calls.eq.push(args);
      return builder;
    }),
    in: vi.fn((...args: unknown[]) => {
      calls.in.push(args);
      return builder;
    }),
    order: vi.fn((...args: unknown[]) => {
      calls.order.push(args);
      return builder;
    }),
    limit: vi.fn(async (...args: unknown[]) => {
      calls.limit.push(args);
      return { data: rows, error: null };
    }),
  };

  return { client: { from: vi.fn(() => builder) }, calls };
}

describe("ApprovalQueueService.getQueue", () => {
  beforeEach(() => requireSupabaseMock.mockReset());

  it("sorts the pending view by priority then newest", async () => {
    const { client, calls } = fakeSupabase([
      row("a", { priority: "normal", created_at: "2026-08-31T23:00:00.000Z" }),
      row("b", { priority: "urgent", created_at: "2026-08-31T21:00:00.000Z" }),
      row("c", { priority: "high", created_at: "2026-08-31T22:00:00.000Z" }),
    ]);
    requireSupabaseMock.mockReturnValue(client);

    const actions = await ApprovalQueueService.getQueue(companyId, {
      status: "pending",
    });

    expect(calls.eq).toContainEqual(["status", "pending"]);
    expect(calls.in).toHaveLength(0);
    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
    expect(actions.map((a) => a.id)).toEqual(["b", "c", "a"]);
    expect(calls.limit).toEqual([[200]]);
  });

  it("filters on the statuses list and orders history by review time", async () => {
    const { client, calls } = fakeSupabase([
      row("a", { status: "executed", priority: "normal" }),
      row("b", { status: "rejected", priority: "urgent" }),
    ]);
    requireSupabaseMock.mockReturnValue(client);

    const actions = await ApprovalQueueService.getQueue(companyId, {
      statuses: [...HISTORY_STATUSES],
    });

    expect(calls.in).toEqual([["status", [...HISTORY_STATUSES]]]);
    expect(calls.order).toEqual([
      ["reviewed_at", { ascending: false, nullsFirst: false }],
      ["updated_at", { ascending: false }],
    ]);
    // Chronological order from the DB is preserved — no priority re-sort.
    expect(actions.map((a) => a.id)).toEqual(["a", "b"]);
    expect(calls.limit).toEqual([[200]]);
  });

  it("keeps the priority sort when the statuses list still includes pending", async () => {
    const { client, calls } = fakeSupabase([
      row("a", { status: "pending", priority: "normal" }),
      row("b", { status: "executed", priority: "urgent" }),
    ]);
    requireSupabaseMock.mockReturnValue(client);

    const actions = await ApprovalQueueService.getQueue(companyId, {
      statuses: ["pending", "executed"],
    });

    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
    expect(actions.map((a) => a.id)).toEqual(["b", "a"]);
  });
});
