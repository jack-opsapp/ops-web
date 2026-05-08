/**
 * useProjectNotes — workspace timeline read + create/update/delete.
 *
 * Smoke coverage:
 *   - useProjectNotes is enabled only when both projectId and companyId
 *     are present
 *   - useCreateProjectNote calls ProjectNoteService.createNote and, when
 *     mentionedUserIds is non-empty, fans out NotificationService rail
 *     entries + dispatchMentionPush. Title lookup is best-effort.
 *   - mention dispatch failure is swallowed (note write must still
 *     succeed)
 *   - useUpdateProjectNote / useDeleteProjectNote each delegate to the
 *     matching service method
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchNotes = vi.fn();
const createNote = vi.fn();
const updateNote = vi.fn();
const deleteNote = vi.fn();
const createMentions = vi.fn();
const dispatchPush = vi.fn();
const supabaseSelect = vi.fn();

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    fetchNotes: (...args: unknown[]) => fetchNotes(...args),
    createNote: (...args: unknown[]) => createNote(...args),
    updateNote: (...args: unknown[]) => updateNote(...args),
    deleteNote: (...args: unknown[]) => deleteNote(...args),
  },
}));

vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: {
    createMentionNotifications: (...args: unknown[]) => createMentions(...args),
  },
}));

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchMentionPush: (...args: unknown[]) => dispatchPush(...args),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => supabaseSelect(),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    currentUser: { id: "u-author", firstName: "Jack", lastName: "Sweet" },
    company: { id: "co-1" },
  }),
}));

import {
  useProjectNotes,
  useCreateProjectNote,
  useUpdateProjectNote,
  useDeleteProjectNote,
} from "@/lib/hooks/use-project-notes";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  fetchNotes.mockReset();
  createNote.mockReset();
  updateNote.mockReset();
  deleteNote.mockReset();
  createMentions.mockReset();
  dispatchPush.mockReset();
  supabaseSelect.mockReset();

  fetchNotes.mockResolvedValue([]);
  createNote.mockResolvedValue({ id: "note-1" });
  updateNote.mockResolvedValue({ id: "note-1" });
  deleteNote.mockResolvedValue(undefined);
  createMentions.mockResolvedValue(undefined);
  supabaseSelect.mockResolvedValue({ data: { title: "Acme HQ" }, error: null });
});

describe("useProjectNotes (read)", () => {
  it("does not query when projectId is undefined", () => {
    renderHook(() => useProjectNotes(undefined), { wrapper: makeWrapper() });
    expect(fetchNotes).not.toHaveBeenCalled();
  });

  it("calls ProjectNoteService.fetchNotes with the project + company id", async () => {
    renderHook(() => useProjectNotes("proj-1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(fetchNotes).toHaveBeenCalledWith("proj-1", "co-1"));
  });
});

describe("useCreateProjectNote", () => {
  it("delegates to ProjectNoteService.createNote and skips mention fan-out when mentionedUserIds is empty", async () => {
    const { result } = renderHook(() => useCreateProjectNote(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        companyId: "co-1",
        authorId: "u-author",
        content: "site walk done",
      });
    });

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(createMentions).not.toHaveBeenCalled();
    expect(dispatchPush).not.toHaveBeenCalled();
  });

  it("fans out NotificationService.createMentionNotifications + dispatchMentionPush when mentionedUserIds is non-empty", async () => {
    const { result } = renderHook(() => useCreateProjectNote(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        companyId: "co-1",
        authorId: "u-author",
        content: "@alice can you confirm?",
        mentionedUserIds: ["u-alice"],
      });
    });

    expect(createMentions).toHaveBeenCalledTimes(1);
    expect(createMentions).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedUserIds: ["u-alice"],
        authorName: "Jack Sweet",
        projectId: "proj-1",
        projectTitle: "Acme HQ",
        noteId: "note-1",
        companyId: "co-1",
      }),
    );
    expect(dispatchPush).toHaveBeenCalledTimes(1);
    expect(dispatchPush).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedUserIds: ["u-alice"],
        notePreview: "@alice can you confirm?",
      }),
    );
  });

  it("swallows mention-dispatch errors so the note still succeeds", async () => {
    // Make NotificationService.createMentionNotifications throw — the
    // hook wraps the whole mention fan-out in a try/catch so the note
    // write itself must still resolve.
    createMentions.mockImplementationOnce(() => {
      throw new Error("rail insert failed");
    });
    const { result } = renderHook(() => useCreateProjectNote(), {
      wrapper: makeWrapper(),
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let resolved: { id: string } | null = null;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        projectId: "proj-1",
        companyId: "co-1",
        authorId: "u-author",
        content: "@alice",
        mentionedUserIds: ["u-alice"],
      });
    });

    // Note write succeeded despite the dispatch error.
    expect(resolved).toEqual(expect.objectContaining({ id: "note-1" }));
    expect(createNote).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

describe("useUpdateProjectNote", () => {
  it("delegates to ProjectNoteService.updateNote", async () => {
    const { result } = renderHook(() => useUpdateProjectNote(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: "note-1",
        projectId: "proj-1",
        content: "updated",
      });
    });

    expect(updateNote).toHaveBeenCalledTimes(1);
  });
});

describe("useDeleteProjectNote", () => {
  it("delegates to ProjectNoteService.deleteNote", async () => {
    const { result } = renderHook(() => useDeleteProjectNote(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "note-1", projectId: "proj-1" });
    });

    expect(deleteNote).toHaveBeenCalledWith("note-1");
  });
});
