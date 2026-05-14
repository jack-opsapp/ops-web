import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTablePhotoService } from "@/lib/api/services/project-table-photo-service";
import { requireSupabase } from "@/lib/supabase/helpers";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

function fetchPhotosQueryMock(result: { data: unknown[] | null; error: null | { message: string } }) {
  const order = vi.fn(async () => result);
  const isDeletedAt = vi.fn(() => ({ order }));
  const eqCompany = vi.fn(() => ({ is: isDeletedAt }));
  const eqProject = vi.fn(() => ({ eq: eqCompany }));
  const select = vi.fn(() => ({ eq: eqProject }));
  const from = vi.fn(() => ({ select }));

  return { from, select, eqProject, eqCompany, isDeletedAt, order };
}

function insertPhotoMock(result: { data: unknown; error: null | { code?: string; message: string } }) {
  const single = vi.fn(async () => result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  return { insert, select, single };
}

function softDeletePhotoMock(result: { error: null | { code?: string; message: string } }) {
  const eq = vi.fn(async () => result);
  const update = vi.fn(() => ({ eq }));
  return { update, eq };
}

function storageMock(params: {
  uploadError?: null | { message: string };
  publicUrl?: string;
}) {
  const upload = vi.fn(async () => ({
    data: params.uploadError ? null : { path: "company-1/project-1/photo-uuid.jpg" },
    error: params.uploadError ?? null,
  }));
  const getPublicUrl = vi.fn(() => ({
    data: { publicUrl: params.publicUrl ?? "https://storage.example.com/photo-uuid.jpg" },
  }));
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const from = vi.fn(() => ({ upload, getPublicUrl, remove }));
  return { from, upload, getPublicUrl, remove };
}

describe("ProjectTablePhotoService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "photo-uuid") });
  });

  it("fetches non-deleted project photos newest first", async () => {
    const mock = fetchPhotosQueryMock({
      data: [
        {
          id: "photo-1",
          project_id: "project-1",
          company_id: "company-1",
          url: "https://example.com/photo.jpg",
          thumbnail_url: "https://example.com/thumb.jpg",
          source: "other",
          uploaded_by: "user-1",
          created_at: "2026-05-13T01:00:00Z",
          deleted_at: null,
          is_client_visible: false,
        },
      ],
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTablePhotoService.fetchProjectPhotos("project-1", "company-1")).resolves.toEqual([
      {
        id: "photo-1",
        projectId: "project-1",
        companyId: "company-1",
        url: "https://example.com/photo.jpg",
        thumbnailUrl: "https://example.com/thumb.jpg",
        source: "other",
        uploadedBy: "user-1",
        createdAt: "2026-05-13T01:00:00Z",
        deletedAt: null,
        isClientVisible: false,
      },
    ]);

    expect(mock.from).toHaveBeenCalledWith("project_photos");
    expect(mock.eqProject).toHaveBeenCalledWith("project_id", "project-1");
    expect(mock.eqCompany).toHaveBeenCalledWith("company_id", "company-1");
    expect(mock.isDeletedAt).toHaveBeenCalledWith("deleted_at", null);
    expect(mock.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("uploads to project-photos and inserts the photo row with source other", async () => {
    const insert = insertPhotoMock({
      data: {
        id: "photo-1",
        project_id: "project-1",
        company_id: "company-1",
        url: "https://storage.example.com/photo-uuid.jpg",
        thumbnail_url: "https://storage.example.com/photo-uuid.jpg",
        source: "other",
        uploaded_by: "user-1",
        created_at: "2026-05-13T01:00:00Z",
        deleted_at: null,
        is_client_visible: false,
      },
      error: null,
    });
    const storage = storageMock({});
    const from = vi.fn((table: string) => {
      if (table === "project_photos") return insert;
      throw new Error(`Unexpected table ${table}`);
    });
    vi.mocked(requireSupabase).mockReturnValue({ from, storage } as never);

    const file = new File(["photo"], "roof.JPG", { type: "image/jpeg" });
    await expect(ProjectTablePhotoService.uploadProjectPhoto({
      companyId: "company-1",
      projectId: "project-1",
      uploadedBy: "user-1",
      file,
    })).resolves.toMatchObject({
      objectPath: "company-1/project-1/photo-uuid.jpg",
      photo: {
        id: "photo-1",
        source: "other",
        uploadedBy: "user-1",
      },
    });

    expect(storage.from).toHaveBeenCalledWith("project-photos");
    expect(storage.upload).toHaveBeenCalledWith(
      "company-1/project-1/photo-uuid.jpg",
      file,
      { cacheControl: "3600", upsert: false },
    );
    expect(insert.insert).toHaveBeenCalledWith({
      company_id: "company-1",
      project_id: "project-1",
      url: "https://storage.example.com/photo-uuid.jpg",
      thumbnail_url: "https://storage.example.com/photo-uuid.jpg",
      source: "other",
      uploaded_by: "user-1",
      is_client_visible: false,
    });
  });

  it("rejects unsupported MIME types before Storage upload", async () => {
    const storage = storageMock({});
    vi.mocked(requireSupabase).mockReturnValue({
      from: vi.fn(),
      storage,
    } as never);

    const file = new File(["not-image"], "scan.gif", { type: "image/gif" });
    await expect(ProjectTablePhotoService.uploadProjectPhoto({
      companyId: "company-1",
      projectId: "project-1",
      uploadedBy: "user-1",
      file,
    })).rejects.toMatchObject({ code: "22023" });

    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("does not insert a DB row when Storage upload fails", async () => {
    const insert = insertPhotoMock({ data: null, error: null });
    const storage = storageMock({ uploadError: { message: "storage denied" } });
    vi.mocked(requireSupabase).mockReturnValue({
      from: vi.fn(() => insert),
      storage,
    } as never);

    const file = new File(["photo"], "roof.png", { type: "image/png" });
    await expect(ProjectTablePhotoService.uploadProjectPhoto({
      companyId: "company-1",
      projectId: "project-1",
      uploadedBy: "user-1",
      file,
    })).rejects.toMatchObject({ code: "UNKNOWN", message: "storage denied" });

    expect(insert.insert).not.toHaveBeenCalled();
  });

  it("removes the uploaded object when DB insert fails", async () => {
    const insert = insertPhotoMock({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    const storage = storageMock({});
    vi.mocked(requireSupabase).mockReturnValue({
      from: vi.fn(() => insert),
      storage,
    } as never);

    const file = new File(["photo"], "roof.webp", { type: "image/webp" });
    await expect(ProjectTablePhotoService.uploadProjectPhoto({
      companyId: "company-1",
      projectId: "project-1",
      uploadedBy: "user-1",
      file,
    })).rejects.toMatchObject({ code: "42501" });

    expect(storage.remove).toHaveBeenCalledWith(["company-1/project-1/photo-uuid.webp"]);
  });

  it("soft-deletes photos by updating deleted_at", async () => {
    const softDelete = softDeletePhotoMock({ error: null });
    vi.mocked(requireSupabase).mockReturnValue({
      from: vi.fn(() => softDelete),
    } as never);

    await expect(ProjectTablePhotoService.deleteProjectPhoto("photo-1")).resolves.toBeUndefined();

    expect(softDelete.update).toHaveBeenCalledWith({
      deleted_at: expect.any(String),
    });
    expect(softDelete.eq).toHaveBeenCalledWith("id", "photo-1");
  });
});
