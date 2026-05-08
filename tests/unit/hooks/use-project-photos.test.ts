/**
 * useProjectPhotos — workspace photo gallery hooks.
 *
 * Smoke coverage:
 *   - useProjectPhotos read is enabled only when projectId + companyId
 *     are both available
 *   - useCreateProjectPhoto saves the photo via ProjectPhotoService and
 *     mirrors the upload to the workspace timeline via
 *     ProjectNoteService.createSystemEvent (eventKind=photo_uploaded)
 *   - timeline write failure is swallowed (gallery is the source of
 *     truth)
 *   - useDeleteProjectPhoto delegates to ProjectPhotoService.deleteProjectPhoto
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchProjectPhotos = vi.fn();
const createProjectPhoto = vi.fn();
const deleteProjectPhoto = vi.fn();
const createSystemEvent = vi.fn();

vi.mock("@/lib/api/services/project-photo-service", () => ({
  ProjectPhotoService: {
    fetchProjectPhotos: (...args: unknown[]) => fetchProjectPhotos(...args),
    createProjectPhoto: (...args: unknown[]) => createProjectPhoto(...args),
    deleteProjectPhoto: (...args: unknown[]) => deleteProjectPhoto(...args),
  },
}));

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createSystemEvent: (...args: unknown[]) => createSystemEvent(...args),
  },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co-1" } }),
}));

import {
  useProjectPhotos,
  useCreateProjectPhoto,
  useDeleteProjectPhoto,
} from "@/lib/hooks/use-project-photos";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  fetchProjectPhotos.mockReset();
  createProjectPhoto.mockReset();
  deleteProjectPhoto.mockReset();
  createSystemEvent.mockReset();

  fetchProjectPhotos.mockResolvedValue([]);
  createProjectPhoto.mockResolvedValue({
    id: "ph-1",
    url: "https://cdn.test/a.jpg",
    thumbnailUrl: "https://cdn.test/a-thumb.jpg",
  });
  deleteProjectPhoto.mockResolvedValue(undefined);
  createSystemEvent.mockResolvedValue({ id: "evt-1" });
});

describe("useProjectPhotos (read)", () => {
  it("does not query when projectId is undefined", () => {
    renderHook(() => useProjectPhotos(undefined), { wrapper: makeWrapper() });
    expect(fetchProjectPhotos).not.toHaveBeenCalled();
  });

  it("calls ProjectPhotoService.fetchProjectPhotos with project + company id", async () => {
    renderHook(() => useProjectPhotos("proj-1"), { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(fetchProjectPhotos).toHaveBeenCalledWith("proj-1", "co-1"),
    );
  });
});

describe("useCreateProjectPhoto", () => {
  it("saves the photo and mirrors a photo_uploaded timeline event", async () => {
    const { result } = renderHook(() => useCreateProjectPhoto(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        companyId: "co-1",
        uploadedBy: "u-author",
        url: "https://cdn.test/a.jpg",
        thumbnailUrl: "https://cdn.test/a-thumb.jpg",
        caption: "After install",
        source: "in_progress",
      });
    });

    expect(createProjectPhoto).toHaveBeenCalledTimes(1);
    expect(createSystemEvent).toHaveBeenCalledTimes(1);
    expect(createSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        companyId: "co-1",
        authorId: "u-author",
        eventKind: "photo_uploaded",
        content: "After install",
        contentMetadata: expect.objectContaining({
          photoId: "ph-1",
          url: "https://cdn.test/a.jpg",
          caption: "After install",
        }),
      }),
    );
  });

  it("swallows timeline-write failures so the gallery upload still succeeds", async () => {
    createSystemEvent.mockImplementationOnce(() => {
      throw new Error("timeline insert failed");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useCreateProjectPhoto(), {
      wrapper: makeWrapper(),
    });

    let resolved: { id: string } | null = null;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        projectId: "proj-1",
        companyId: "co-1",
        uploadedBy: "u-author",
        url: "https://cdn.test/a.jpg",
        thumbnailUrl: null,
        caption: null,
        source: "in_progress",
      });
    });

    expect(resolved).toEqual(expect.objectContaining({ id: "ph-1" }));
    expect(createProjectPhoto).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

describe("useDeleteProjectPhoto", () => {
  it("delegates to ProjectPhotoService.deleteProjectPhoto", async () => {
    const { result } = renderHook(() => useDeleteProjectPhoto(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "ph-1", projectId: "proj-1" });
    });

    expect(deleteProjectPhoto).toHaveBeenCalledWith("ph-1");
  });
});
