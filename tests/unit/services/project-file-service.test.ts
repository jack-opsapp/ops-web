import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ rpc: rpcMock }),
  parseDateRequired: (value: string) => new Date(value),
}));

import { ProjectFileService } from "@/lib/api/services/project-file-service";

describe("ProjectFileService website intake files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps only guarded download descriptors without storage lineage", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          filename: "site-plan.pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          source_opportunity_id: "22222222-2222-4222-8222-222222222222",
          updated_at: "2026-07-26T22:00:00+00:00",
          download_url:
            "/api/opportunities/22222222-2222-4222-8222-222222222222/intake-attachments/33333333-3333-4333-8333-333333333333?mode=download",
        },
      ],
      error: null,
    });

    const documents = await ProjectFileService.listProjectIntakeDocuments(
      "44444444-4444-4444-8444-444444444444"
    );

    expect(rpcMock).toHaveBeenCalledWith("list_project_intake_files", {
      p_project_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(documents).toEqual([
      expect.objectContaining({
        filename: "site-plan.pdf",
        sourceType: "intake_attachment",
        sourceLabel: "website",
        pdfStoragePath:
          "/api/opportunities/22222222-2222-4222-8222-222222222222/intake-attachments/33333333-3333-4333-8333-333333333333?mode=download",
        value: null,
      }),
    ]);
    expect(documents[0]).not.toHaveProperty("storageObjectKey");
    expect(documents[0]).not.toHaveProperty("objectVersionId");
  });

  it("fails closed on malformed or denied reads", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ storage_object_key: "accepted-original/private" }],
      error: null,
    });
    await expect(
      ProjectFileService.listProjectIntakeDocuments(
        "44444444-4444-4444-8444-444444444444"
      )
    ).resolves.toEqual([]);

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "access_denied" },
    });
    await expect(
      ProjectFileService.listProjectIntakeDocuments(
        "44444444-4444-4444-8444-444444444444"
      )
    ).resolves.toEqual([]);
  });
});
