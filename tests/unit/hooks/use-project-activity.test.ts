/**
 * useProjectActivity — workspace timeline reader (project_notes-canonical)
 *
 * Reads `project_notes` for a project. event_kind discriminates user notes
 * (NULL → kind='note') from system events (status_change, payment_received,
 * etc.). content_metadata carries structured event payloads. Authors are
 * hydrated via a follow-up users query (no FK).
 *
 * IMPORTANT: must NOT read from `activities` — that table is no longer the
 * primary source for the workspace timeline. The previous implementation
 * (commit d0943de1) read activities and is being reworked here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock state ─────────────────────────────────────────────────────────────

interface MockNote {
  id: string;
  content: string;
  content_metadata: Record<string, unknown> | null;
  event_kind: string | null;
  created_at: string;
  attachments: Array<{ url: string; caption: string | null; markedUpUrl: string | null }>;
  mentioned_user_ids: string[];
  author_id: string | null;
}

interface MockUser {
  id: string;
  first_name: string;
  last_name: string;
  user_color: string | null;
}

let mockNotes: MockNote[] = [];
let mockUsers: MockUser[] = [];
let lastNotesLimit: number | null = null;
let activitiesTableHits = 0;
let projectNotesTableHits = 0;

// ─── Mock supabase ───────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table === "activities") {
        activitiesTableHits++;
        throw new Error("useProjectActivity must not read from activities — use project_notes");
      }
      if (table === "project_notes") {
        projectNotesTableHits++;
        const builder = {
          _filters: { projectId: null as string | null, includeDeleted: false },
          select: () => builder,
          eq: (_col: string, val: string) => {
            builder._filters.projectId = val;
            return builder;
          },
          is: (_col: string, _val: unknown) => builder, // deleted_at IS NULL
          order: () => builder,
          limit: (n: number) => {
            lastNotesLimit = n;
            const rows = mockNotes
              .filter((r) => !builder._filters.projectId || true)
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
              .slice(0, n);
            return Promise.resolve({ data: rows, error: null });
          },
        };
        return builder;
      }
      if (table === "users") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: mockUsers.filter((u) => ids.includes(u.id)),
                error: null,
              }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

// ─── Test harness ────────────────────────────────────────────────────────────

import { useProjectActivity } from "@/lib/hooks/use-project-activity";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function makeNote(overrides: Partial<MockNote> = {}, idx = 0): MockNote {
  return {
    id: `note-${idx}`,
    content: `body ${idx}`,
    content_metadata: null,
    event_kind: null,
    created_at: new Date(Date.UTC(2026, 4, 6, 12 - idx, 0, 0)).toISOString(),
    attachments: [],
    mentioned_user_ids: [],
    author_id: `u-${idx % 2}`,
    ...overrides,
  };
}

beforeEach(() => {
  mockNotes = [];
  mockUsers = [];
  lastNotesLimit = null;
  activitiesTableHits = 0;
  projectNotesTableHits = 0;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useProjectActivity (project_notes-canonical)", () => {
  it("reads from project_notes and never from activities", async () => {
    mockNotes = [makeNote()];
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(activitiesTableHits).toBe(0);
    expect(projectNotesTableHits).toBeGreaterThan(0);
  });

  it("returns rows sorted by created_at desc, limited to 25 by default", async () => {
    mockNotes = Array.from({ length: 40 }).map((_, i) => makeNote({}, i));
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
      { id: "u-1", first_name: "Bob", last_name: "Brown", user_color: "#C4A868" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(25);
    expect(lastNotesLimit).toBe(25);
    const data = result.current.data!;
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].createdAt >= data[i].createdAt).toBe(true);
    }
  });

  it("respects custom limit", async () => {
    mockNotes = Array.from({ length: 10 }).map((_, i) => makeNote({}, i));
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
      { id: "u-1", first_name: "Bob", last_name: "Brown", user_color: "#C4A868" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1", 5), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(5);
    expect(lastNotesLimit).toBe(5);
  });

  it("maps NULL event_kind to kind='note'", async () => {
    mockNotes = [makeNote({ event_kind: null, content: "user-authored note" })];
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0].kind).toBe("note");
    expect(result.current.data![0].content).toBe("user-authored note");
    expect(result.current.data![0].eventPayload).toBeNull();
  });

  it("maps non-null event_kind through verbatim and exposes content_metadata as eventPayload", async () => {
    mockNotes = [
      makeNote(
        {
          event_kind: "status_change",
          content_metadata: { from: "Accepted", to: "InProgress" },
          content: "Status: Accepted → InProgress",
        },
        0,
      ),
      makeNote(
        {
          event_kind: "payment_received",
          content_metadata: { paymentId: "pay-1", amount: 5000, method: "etransfer" },
          content: "Payment received",
        },
        1,
      ),
    ];
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
      { id: "u-1", first_name: "Bob", last_name: "Brown", user_color: "#C4A868" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    const sc = data.find((d) => d.kind === "status_change")!;
    expect(sc.eventPayload).toEqual({ from: "Accepted", to: "InProgress" });

    const pr = data.find((d) => d.kind === "payment_received")!;
    expect(pr.eventPayload).toEqual({ paymentId: "pay-1", amount: 5000, method: "etransfer" });
  });

  it("hydrates author from users table via author_id (single follow-up query)", async () => {
    mockNotes = [makeNote({ author_id: "u-0" })];
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0].author).toEqual({
      id: "u-0",
      name: "Alice Anderson",
      avatarColor: "#9DB582",
    });
  });

  it("falls back to default avatar color when user_color is NULL", async () => {
    mockNotes = [makeNote({ author_id: "u-0" })];
    mockUsers = [{ id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: null }];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].author?.avatarColor).toBe("#6F94B0");
  });

  it("returns author=null when author_id is null (system events with no author)", async () => {
    mockNotes = [
      makeNote({
        author_id: null,
        event_kind: "project_archived",
        content_metadata: {},
      }),
    ];
    mockUsers = [];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].author).toBeNull();
  });

  it("passes through attachments and mentionedUserIds verbatim", async () => {
    mockNotes = [
      makeNote({
        attachments: [
          { url: "https://cdn.test/a.jpg", caption: "before", markedUpUrl: null },
          { url: "https://cdn.test/b.jpg", caption: null, markedUpUrl: "https://cdn.test/b-x.jpg" },
        ],
        mentioned_user_ids: ["u-7", "u-8"],
      }),
    ];
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].attachments).toHaveLength(2);
    expect(result.current.data![0].attachments[0]).toEqual({
      url: "https://cdn.test/a.jpg",
      caption: "before",
      markedUpUrl: null,
    });
    expect(result.current.data![0].mentionedUserIds).toEqual(["u-7", "u-8"]);
  });

  it("returns empty array when projectId is null (and does not fetch)", async () => {
    mockNotes = [makeNote()];

    const { result } = renderHook(() => useProjectActivity(null), {
      wrapper: makeWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(projectNotesTableHits).toBe(0);
  });
});
