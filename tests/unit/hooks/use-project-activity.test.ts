/**
 * useProjectActivity — workspace timeline hook
 *
 * Reads `activities` for a project, joins:
 *   - users.id, first_name, last_name, user_color  (created_by) — separate fetch (no FK)
 *   - project_photos.id, url, thumbnail_url        (attachment_ids[]) — separate fetch
 * Returns rows sorted by created_at desc, limited.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock state ─────────────────────────────────────────────────────────────

interface MockActivity {
  id: string;
  type: string;
  subject: string | null;
  content: string | null;
  created_at: string;
  created_by: string | null;
  attachment_ids: string[] | null;
}

interface MockUser {
  id: string;
  first_name: string;
  last_name: string;
  user_color: string | null;
}

interface MockPhoto {
  id: string;
  url: string;
  thumbnail_url: string | null;
}

let mockActivities: MockActivity[] = [];
let mockUsers: MockUser[] = [];
let mockPhotos: MockPhoto[] = [];
let lastActivityLimit: number | null = null;

// ─── Mock supabase ───────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table === "activities") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: (n: number) => {
                  lastActivityLimit = n;
                  // Return rows sorted desc by created_at, sliced to limit
                  const sorted = [...mockActivities].sort((a, b) =>
                    a.created_at < b.created_at ? 1 : -1
                  );
                  return Promise.resolve({
                    data: sorted.slice(0, n),
                    error: null,
                  });
                },
              }),
            }),
          }),
        };
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
      if (table === "project_photos") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: mockPhotos.filter((p) => ids.includes(p.id)),
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

function seedActivities(n: number, withPhotos = false): MockActivity[] {
  return Array.from({ length: n }).map((_, i) => ({
    id: `act-${i}`,
    type: i % 3 === 0 ? "note" : i % 3 === 1 ? "system" : "email",
    subject: `subject ${i}`,
    content: `body ${i}`,
    // Spread created_at across the past N hours so sorting is meaningful
    created_at: new Date(Date.UTC(2026, 4, 6, 12 - i, 0, 0)).toISOString(),
    created_by: `u-${i % 2}`,
    attachment_ids: withPhotos && i === 0 ? ["photo-A", "photo-B"] : [],
  }));
}

beforeEach(() => {
  mockActivities = [];
  mockUsers = [];
  mockPhotos = [];
  lastActivityLimit = null;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useProjectActivity", () => {
  it("returns activities sorted by created_at desc, limited to 25 by default", async () => {
    mockActivities = seedActivities(40);
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
      { id: "u-1", first_name: "Bob", last_name: "Brown", user_color: "#C4A868" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(25);
    expect(lastActivityLimit).toBe(25);
    // First entry has the most recent createdAt
    const data = result.current.data!;
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].createdAt >= data[i].createdAt).toBe(true);
    }
  });

  it("respects custom limit", async () => {
    mockActivities = seedActivities(10);
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
      { id: "u-1", first_name: "Bob", last_name: "Brown", user_color: "#C4A868" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1", 5), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(5);
    expect(lastActivityLimit).toBe(5);
  });

  it("resolves attachment_ids to project_photos with url + thumbnail", async () => {
    mockActivities = seedActivities(3, true);
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
      { id: "u-1", first_name: "Bob", last_name: "Brown", user_color: "#C4A868" },
    ];
    mockPhotos = [
      { id: "photo-A", url: "https://cdn.test/a.jpg", thumbnail_url: "https://cdn.test/a-thumb.jpg" },
      { id: "photo-B", url: "https://cdn.test/b.jpg", thumbnail_url: null },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const photoActivity = result.current.data!.find((a) => a.attachments.length > 0);
    expect(photoActivity).toBeDefined();
    expect(photoActivity!.attachments).toHaveLength(2);
    expect(photoActivity!.attachments[0]).toEqual({
      id: "photo-A",
      url: "https://cdn.test/a.jpg",
      thumbnailUrl: "https://cdn.test/a-thumb.jpg",
    });
    expect(photoActivity!.attachments[1].thumbnailUrl).toBeNull();
  });

  it("populates createdBy from users join with full name", async () => {
    mockActivities = [
      {
        id: "act-1",
        type: "note",
        subject: "test",
        content: "body",
        created_at: new Date().toISOString(),
        created_by: "u-0",
        attachment_ids: [],
      },
    ];
    mockUsers = [
      { id: "u-0", first_name: "Alice", last_name: "Anderson", user_color: "#9DB582" },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0].createdBy).toEqual({
      id: "u-0",
      name: "Alice Anderson",
      avatarColor: "#9DB582",
    });
  });

  it("returns empty array when projectId is null (and does not fetch)", async () => {
    mockActivities = seedActivities(3);

    const { result } = renderHook(() => useProjectActivity(null), {
      wrapper: makeWrapper(),
    });

    // The hook is disabled — it never enters fetching state.
    expect(result.current.isFetching).toBe(false);
    expect(lastActivityLimit).toBeNull();
  });

  it("handles activities with null created_by (system entries)", async () => {
    mockActivities = [
      {
        id: "act-1",
        type: "system",
        subject: "status changed",
        content: null,
        created_at: new Date().toISOString(),
        created_by: null,
        attachment_ids: [],
      },
    ];

    const { result } = renderHook(() => useProjectActivity("proj-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].createdBy).toBeNull();
  });
});
