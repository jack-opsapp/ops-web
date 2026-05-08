/**
 * Integration test for the workspace note-posting + @mention pathway
 * (Phase 11.3).
 *
 * The ActivityTab composer submits a note via `useCreateProjectNote`. When
 * the author tagged team members, the hook must fan out:
 *   1. project_notes row inserted with event_kind=null (plain note) and
 *      mentioned_user_ids carrying the tagged user ids.
 *   2. NotificationService.createMentionNotifications called once — this
 *      inserts one in-app notification row per mentioned user.
 *   3. dispatchMentionPush called once with the array of mentioned users.
 *
 * Strategy: mock the underlying note service, the notification service,
 * the dispatch helper, and supabase (used by the hook to look up the
 * project title). Drive the mutation directly via renderHook — the
 * activity-tab integration is covered by component tests; this test
 * locks the dispatch contract at the hook level.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const createNoteMock = vi.fn<
  (input: unknown) => Promise<{
    id: string;
    projectId: string;
    companyId: string;
    authorId: string;
    content: string;
    attachments: unknown[];
    mentionedUserIds: string[];
    createdAt: Date;
    updatedAt: Date | null;
    deletedAt: Date | null;
  }>
>(() =>
  Promise.resolve({
    id: "note-1",
    projectId: "p-1",
    companyId: "co-1",
    authorId: "u-author",
    content: "Hey @alice and @bob, take a look",
    attachments: [],
    mentionedUserIds: ["u-alice", "u-bob"],
    createdAt: new Date(),
    updatedAt: null,
    deletedAt: null,
  }),
);

interface MentionNotifCall {
  mentionedUserIds: string[];
  authorName: string;
  projectId: string;
  projectTitle: string;
  noteId: string;
  companyId: string;
}
const mentionNotifs: MentionNotifCall[] = [];

interface MentionPushCall {
  mentionedUserIds: string[];
  authorName: string;
  notePreview: string;
  projectId: string;
  projectTitle: string;
  noteId: string;
  companyId: string;
}
const mentionPushes: MentionPushCall[] = [];

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createNote: (input: unknown) => createNoteMock(input),
  },
}));

vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: {
    createMentionNotifications: (params: MentionNotifCall) => {
      mentionNotifs.push(params);
      return Promise.resolve();
    },
  },
}));

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchMentionPush: (params: MentionPushCall) => {
    mentionPushes.push(params);
  },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    company: { id: "co-1" },
    currentUser: { id: "u-author", firstName: "Alex", lastName: "Operator" },
  }),
}));

// supabase lookup for project title — return the canonical row.
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { title: "Roof Replacement" },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in test: ${table}`);
    },
  }),
  parseDate: (v: string | null) => (v ? new Date(v) : null),
  parseDateRequired: (v: string) => new Date(v),
}));

import { useCreateProjectNote } from "@/lib/hooks/use-project-notes";

beforeEach(() => {
  createNoteMock.mockClear();
  mentionNotifs.length = 0;
  mentionPushes.length = 0;
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("useCreateProjectNote — @mention notifications", () => {
  it("inserts the note, creates per-user mention notifications, and pushes once", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useCreateProjectNote(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "p-1",
        companyId: "co-1",
        authorId: "u-author",
        content: "Hey @alice and @bob, take a look",
        mentionedUserIds: ["u-alice", "u-bob"],
        attachments: [],
      });
    });

    // (a) note row inserted with mentioned_user_ids
    expect(createNoteMock).toHaveBeenCalledOnce();
    const noteArgs = createNoteMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(noteArgs.mentionedUserIds).toEqual(["u-alice", "u-bob"]);

    // (b) one in-app notification row per mentioned user — modeled as a
    // single createMentionNotifications call carrying both ids.
    expect(mentionNotifs).toHaveLength(1);
    expect(mentionNotifs[0].mentionedUserIds).toEqual(["u-alice", "u-bob"]);
    expect(mentionNotifs[0].authorName).toBe("Alex Operator");
    expect(mentionNotifs[0].projectTitle).toBe("Roof Replacement");
    expect(mentionNotifs[0].noteId).toBe("note-1");

    // (c) push dispatch fired once with the full mention list
    expect(mentionPushes).toHaveLength(1);
    expect(mentionPushes[0].mentionedUserIds).toEqual(["u-alice", "u-bob"]);
    expect(mentionPushes[0].notePreview).toBe(
      "Hey @alice and @bob, take a look",
    );
  });

  it("skips both mention paths when no users are tagged", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useCreateProjectNote(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "p-1",
        companyId: "co-1",
        authorId: "u-author",
        content: "Just a plain note",
        mentionedUserIds: [],
        attachments: [],
      });
    });

    expect(createNoteMock).toHaveBeenCalledOnce();
    expect(mentionNotifs).toHaveLength(0);
    expect(mentionPushes).toHaveLength(0);
  });
});
