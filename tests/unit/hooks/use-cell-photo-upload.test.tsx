import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectNoteService } from "@/lib/api/services/project-note-service";
import { ProjectTablePhotoService } from "@/lib/api/services/project-table-photo-service";
import { useCellPhotoUpload } from "@/lib/hooks/projects-table/use-cell-photo-upload";
import { ProjectStatus } from "@/lib/types/models";
import type { ProjectTableRow } from "@/lib/types/project-table";

const authState: {
  company: { id: string } | null;
  currentUser: { id: string } | null;
} = {
  company: { id: "company-1" },
  currentUser: { id: "user-1" },
};

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (selector?: (state: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

vi.mock("@/lib/api/services/project-table-photo-service", () => ({
  ProjectTablePhotoService: {
    fetchProjectPhotos: vi.fn(),
    uploadProjectPhoto: vi.fn(),
    deleteProjectPhoto: vi.fn(),
  },
}));

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createSystemEvent: vi.fn(),
  },
}));

vi.mock("@/lib/analytics/analytics-service", () => ({
  analyticsService: {
    track: vi.fn(),
  },
}));

const row: ProjectTableRow = {
  id: "project-1",
  companyId: "company-1",
  title: "Deck rebuild",
  status: ProjectStatus.Accepted,
  rawStatus: "accepted",
  clientId: null,
  clientName: null,
  clientEmail: null,
  clientPhone: null,
  address: null,
  teamMemberIds: [],
  startDate: null,
  endDate: null,
  duration: null,
  progress: null,
  nextTask: null,
  taskCount: 0,
  taskCompletedCount: 0,
  daysInStatus: null,
  estimateTotal: null,
  invoiceTotal: null,
  paidTotal: null,
  value: null,
  projectCost: null,
  margin: null,
  photoCount: 0,
  updatedAt: "2026-05-13T00:00:00Z",
};

type InfiniteRowsData = {
  pages: Array<{ rows: ProjectTableRow[]; count: number; nextPage: number | null }>;
  pageParams: number[];
};

const tableRowsKey = queryKeys.projects.tableRows({ companyId: "company-1", viewId: "view-1" });

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function seedTableRows(queryClient: QueryClient) {
  queryClient.setQueryData<InfiniteRowsData>(tableRowsKey, {
    pages: [{ rows: [row], count: 1, nextPage: null }],
    pageParams: [0],
  });
}

describe("useCellPhotoUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.company = { id: "company-1" };
    authState.currentUser = { id: "user-1" };
    vi.mocked(ProjectTablePhotoService.fetchProjectPhotos).mockResolvedValue([]);
    vi.mocked(ProjectTablePhotoService.uploadProjectPhoto).mockResolvedValue({
      objectPath: "company-1/project-1/photo.jpg",
      photo: {
        id: "photo-1",
        projectId: "project-1",
        companyId: "company-1",
        url: "https://storage.test/photo.jpg",
        thumbnailUrl: "https://storage.test/photo.jpg",
        source: "other",
        uploadedBy: "user-1",
        createdAt: "2026-05-13T01:00:00Z",
        deletedAt: null,
        isClientVisible: false,
      },
    });
    vi.mocked(ProjectNoteService.createSystemEvent).mockResolvedValue({
      id: "note-1",
      projectId: "project-1",
      companyId: "company-1",
      authorId: "user-1",
      content: "",
      attachments: [],
      mentionedUserIds: [],
      createdAt: new Date("2026-05-13T01:00:00Z"),
      updatedAt: null,
      deletedAt: null,
    });
    vi.mocked(ProjectTablePhotoService.deleteProjectPhoto).mockResolvedValue(undefined);
  });

  it("fetches photos with the auth company id", async () => {
    const queryClient = makeQueryClient();

    const { result } = renderHook(() => useCellPhotoUpload({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.photosQuery.isSuccess).toBe(true));

    expect(ProjectTablePhotoService.fetchProjectPhotos).toHaveBeenCalledWith(
      "project-1",
      "company-1",
    );
  });

  it("rejects before Storage upload when auth user is missing", async () => {
    const queryClient = makeQueryClient();
    authState.currentUser = null;

    const { result } = renderHook(() => useCellPhotoUpload({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await expect(
      result.current.uploadPhoto.mutateAsync(new File(["photo"], "roof.jpg", { type: "image/jpeg" })),
    ).rejects.toMatchObject({
      name: "ProjectTableMutationError",
      code: "22023",
    });
    expect(ProjectTablePhotoService.uploadProjectPhoto).not.toHaveBeenCalled();
  });

  it("rejects before Storage upload when company is missing", async () => {
    const queryClient = makeQueryClient();
    authState.company = null;

    const { result } = renderHook(() => useCellPhotoUpload({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await expect(
      result.current.uploadPhoto.mutateAsync(new File(["photo"], "roof.jpg", { type: "image/jpeg" })),
    ).rejects.toMatchObject({
      name: "ProjectTableMutationError",
      code: "22023",
    });
    expect(ProjectTablePhotoService.uploadProjectPhoto).not.toHaveBeenCalled();
  });

  it("uploads with auth identifiers, invalidates photo reads, and increments table photo count", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const file = new File(["photo"], "roof.jpg", { type: "image/jpeg" });

    const { result } = renderHook(() => useCellPhotoUpload({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.uploadPhoto.mutateAsync(file);
    });

    expect(ProjectTablePhotoService.uploadProjectPhoto).toHaveBeenCalledWith({
      companyId: "company-1",
      projectId: "project-1",
      uploadedBy: "user-1",
      file,
    });
    expect(ProjectNoteService.createSystemEvent).toHaveBeenCalledWith({
      projectId: "project-1",
      companyId: "company-1",
      authorId: "user-1",
      eventKind: "photo_uploaded",
      content: "",
      contentMetadata: {
        photoId: "photo-1",
        url: "https://storage.test/photo.jpg",
        thumbnailUrl: "https://storage.test/photo.jpg",
        caption: null,
      },
    });
    expect(analyticsService.track).toHaveBeenCalledWith(
      "action",
      "project_table_photo_uploaded",
      {
        project_id: "project-1",
        file_count: 1,
        success_count: 1,
        failed_count: 0,
      },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.projectPhotos.byProject("project-1"),
    });
    expect(
      queryClient.getQueryData<InfiniteRowsData>(tableRowsKey)?.pages[0]?.rows[0]?.photoCount,
    ).toBe(1);
  });

  it("keeps the upload successful when the best-effort timeline event fails", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ProjectNoteService.createSystemEvent).mockRejectedValueOnce(
      new Error("timeline offline"),
    );
    const file = new File(["photo"], "roof.jpg", { type: "image/jpeg" });

    const { result } = renderHook(() => useCellPhotoUpload({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.uploadPhoto.mutateAsync(file)).resolves.toMatchObject({
        photo: { id: "photo-1" },
      });
    });

    expect(ProjectTablePhotoService.uploadProjectPhoto).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<InfiniteRowsData>(tableRowsKey)?.pages[0]?.rows[0]?.photoCount,
    ).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[use-cell-photo-upload] Timeline write failed:",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it("tracks failed upload attempts without file names", async () => {
    const queryClient = makeQueryClient();
    vi.mocked(ProjectTablePhotoService.uploadProjectPhoto).mockRejectedValueOnce(
      new Error("storage denied"),
    );

    const { result } = renderHook(() => useCellPhotoUpload({ row }), {
      wrapper: makeWrapper(queryClient),
    });

    await expect(
      result.current.uploadPhoto.mutateAsync(new File(["photo"], "roof.jpg", { type: "image/jpeg" })),
    ).rejects.toThrow("storage denied");

    expect(analyticsService.track).toHaveBeenCalledWith(
      "action",
      "project_table_photo_uploaded",
      {
        project_id: "project-1",
        file_count: 1,
        success_count: 0,
        failed_count: 1,
      },
    );
  });

  it("soft-deletes a photo and decrements the table photo count", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    queryClient.setQueryData<InfiniteRowsData>(tableRowsKey, {
      pages: [{ rows: [{ ...row, photoCount: 2 }], count: 1, nextPage: null }],
      pageParams: [0],
    });

    const { result } = renderHook(() => useCellPhotoUpload({ row: { ...row, photoCount: 2 } }), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.deletePhoto.mutateAsync("photo-1");
    });

    expect(ProjectTablePhotoService.deleteProjectPhoto).toHaveBeenCalledWith("photo-1");
    expect(
      queryClient.getQueryData<InfiniteRowsData>(tableRowsKey)?.pages[0]?.rows[0]?.photoCount,
    ).toBe(1);
  });
});
