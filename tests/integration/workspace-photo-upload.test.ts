/**
 * Integration test for the workspace photo-upload pathway (Phase 11.4).
 *
 * `useCreateProjectPhoto` inserts a photo row into project_photos. The
 * Phase 11.4 contract: after a successful photo insert, also write a
 * project_notes row with event_kind='photo_uploaded' so the workspace
 * Activity tab shows a timeline entry. No notification dispatch — photos
 * are too noisy to fan out to the team.
 *
 * If the timeline write fails (network blip, RLS edge case), the photo
 * is still in the gallery — surface the error to the console but don't
 * fail the mutation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ─────────────────────────────────────────────────────────────────

interface CreatePhotoCall {
  projectId: string;
  companyId: string;
  url: string;
  uploadedBy: string;
  thumbnailUrl?: string | null;
  source: string;
  caption?: string | null;
}
const createPhotoMock = vi.fn<
  (input: CreatePhotoCall) => Promise<{
    id: string;
    projectId: string;
    companyId: string;
    url: string;
    thumbnailUrl: string | null;
    source: string;
    siteVisitId: string | null;
    uploadedBy: string;
    takenAt: Date | null;
    caption: string | null;
    deletedAt: Date | null;
    createdAt: Date;
    isClientVisible: boolean;
  }>
>((input) =>
  Promise.resolve({
    id: "photo-1",
    projectId: input.projectId,
    companyId: input.companyId,
    url: input.url,
    thumbnailUrl: input.thumbnailUrl ?? null,
    source: input.source,
    siteVisitId: null,
    uploadedBy: input.uploadedBy,
    takenAt: null,
    caption: input.caption ?? null,
    deletedAt: null,
    createdAt: new Date(),
    isClientVisible: false,
  }),
);

interface SystemEventCall {
  projectId: string;
  companyId: string;
  authorId: string;
  eventKind: string;
  content: string;
  contentMetadata: Record<string, unknown> | null;
}
const systemEvents: SystemEventCall[] = [];

interface DispatchCall {
  fn: string;
  params: Record<string, unknown>;
}
const dispatches: DispatchCall[] = [];

vi.mock("@/lib/api/services/project-photo-service", () => ({
  ProjectPhotoService: {
    createProjectPhoto: (input: CreatePhotoCall) => createPhotoMock(input),
  },
}));

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createSystemEvent: (input: SystemEventCall) => {
      systemEvents.push(input);
      return Promise.resolve({ id: `note-${systemEvents.length}` });
    },
  },
}));

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchProjectAssignment: (params: Record<string, unknown>) =>
    dispatches.push({ fn: "dispatchProjectAssignment", params }),
  dispatchProjectStatusChange: (params: Record<string, unknown>) =>
    dispatches.push({ fn: "dispatchProjectStatusChange", params }),
  dispatchTaskAssignment: (params: Record<string, unknown>) =>
    dispatches.push({ fn: "dispatchTaskAssignment", params }),
  dispatchTaskCompleted: (params: Record<string, unknown>) =>
    dispatches.push({ fn: "dispatchTaskCompleted", params }),
  dispatchScheduleChange: (params: Record<string, unknown>) =>
    dispatches.push({ fn: "dispatchScheduleChange", params }),
  dispatchMentionPush: (params: Record<string, unknown>) =>
    dispatches.push({ fn: "dispatchMentionPush", params }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    company: { id: "co-1" },
    currentUser: { id: "u-1", firstName: "Alex", lastName: "Operator" },
  }),
}));

import { useCreateProjectPhoto } from "@/lib/hooks/use-project-photos";

beforeEach(() => {
  createPhotoMock.mockClear();
  systemEvents.length = 0;
  dispatches.length = 0;
});

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("useCreateProjectPhoto — timeline integration", () => {
  it("writes photo row + project_notes timeline entry, fires no dispatches", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useCreateProjectPhoto(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "p-1",
        companyId: "co-1",
        url: "https://cdn/photos/full.jpg",
        thumbnailUrl: "https://cdn/photos/thumb.jpg",
        source: "in_progress",
        uploadedBy: "u-1",
        caption: "Roof underlayment installed",
      });
    });

    // (a) photo row inserted
    expect(createPhotoMock).toHaveBeenCalledOnce();
    expect(createPhotoMock.mock.calls[0]![0].url).toBe(
      "https://cdn/photos/full.jpg",
    );

    // (b) project_notes row written with event_kind=photo_uploaded
    expect(systemEvents).toHaveLength(1);
    const ev = systemEvents[0];
    expect(ev.projectId).toBe("p-1");
    expect(ev.companyId).toBe("co-1");
    expect(ev.eventKind).toBe("photo_uploaded");
    expect(ev.authorId).toBe("u-1");
    expect(ev.contentMetadata).toEqual({
      photoId: "photo-1",
      url: "https://cdn/photos/full.jpg",
      thumbnailUrl: "https://cdn/photos/thumb.jpg",
      caption: "Roof underlayment installed",
    });

    // (c) NO notification dispatch — photos are too noisy
    expect(dispatches).toHaveLength(0);
  });

  it("omits caption from metadata when not provided", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useCreateProjectPhoto(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "p-1",
        companyId: "co-1",
        url: "https://cdn/photos/full.jpg",
        source: "in_progress",
        uploadedBy: "u-1",
      });
    });

    expect(systemEvents).toHaveLength(1);
    const ev = systemEvents[0];
    expect(ev.eventKind).toBe("photo_uploaded");
    const meta = ev.contentMetadata as Record<string, unknown>;
    expect(meta.photoId).toBe("photo-1");
    expect(meta.url).toBe("https://cdn/photos/full.jpg");
    expect(meta.thumbnailUrl).toBeNull();
    // caption omitted — null is fine but a missing key is also fine
    expect(meta.caption ?? null).toBeNull();
  });
});
