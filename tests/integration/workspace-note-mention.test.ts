/**
 * Integration test for the workspace note-posting + @mention pathway
 * (Phase 11.3).
 *
 * The ActivityTab composer submits a note via `useCreateProjectNote`. When
 * the author tagged team members, the hook must fan out:
 *   1. project_notes row inserted with event_kind=null (plain note) and
 *      mentioned_user_ids carrying the tagged user ids.
 *   2. dispatchMentionPush called once with only the persisted note id. The
 *      server derives recipients, copy, navigation, and push payload.
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
  })
);

interface MentionPushCall {
  noteId: string;
}
const mentionPushes: MentionPushCall[] = [];

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createNote: (input: unknown) => createNoteMock(input),
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

import { useCreateProjectNote } from "@/lib/hooks/use-project-notes";

beforeEach(() => {
  createNoteMock.mockClear();
  mentionPushes.length = 0;
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("useCreateProjectNote — @mention notifications", () => {
  it("inserts the note and dispatches its persisted id once", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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
    const noteArgs = createNoteMock.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(noteArgs.mentionedUserIds).toEqual(["u-alice", "u-bob"]);

    // (b) notification dispatch receives no body-trusted recipient or copy.
    expect(mentionPushes).toHaveLength(1);
    expect(mentionPushes[0]).toEqual({ noteId: "note-1" });
  });

  it("skips both mention paths when no users are tagged", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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
    expect(mentionPushes).toHaveLength(0);
  });
});
