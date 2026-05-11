import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase so requireSupabase doesn't try to init Firebase/Supabase
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
}));

// Mock Firebase so importing company-service doesn't explode
vi.mock("@/lib/firebase/config", () => ({
  getFirebaseApp: vi.fn(),
  getFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: vi.fn(),
}));

import { requireSupabase } from "@/lib/supabase/helpers";
import { CompanyService } from "@/lib/api/services/company-service";

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe("CompanyService.getPresignedUrlProfile (post-migration)", () => {
  it("calls /api/uploads/presign with profile folder", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        uploadUrl: "https://s3.amazonaws.com/bucket/profiles/123-logo.jpg?sig=abc",
        publicUrl: "https://s3.amazonaws.com/bucket/profiles/123-logo.jpg",
      }),
    } as never);

    const result = await CompanyService.getPresignedUrlProfile(
      "co-uuid",
      "logo.jpg",
      "image/jpeg"
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/uploads/presign",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(
      vi.mocked(global.fetch).mock.calls[0][1]?.body as string
    );
    expect(body.folder).toBe("profiles/co-uuid");
    expect(result.publicUrl).toContain("logo.jpg");
  });
});

describe("CompanyService.getPresignedUrlProject (post-migration)", () => {
  it("calls /api/uploads/presign with project folder", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        uploadUrl: "https://s3.amazonaws.com/bucket/projects/proj-abc/photo.jpg?sig=x",
        publicUrl: "https://s3.amazonaws.com/bucket/projects/proj-abc/photo.jpg",
      }),
    } as never);

    const result = await CompanyService.getPresignedUrlProject(
      "co-uuid",
      "proj-abc",
      "photo.jpg"
    );

    const body = JSON.parse(
      vi.mocked(global.fetch).mock.calls[0][1]?.body as string
    );
    expect(body.folder).toBe("projects/proj-abc");
    expect(result.publicUrl).toContain("photo.jpg");
  });
});

describe("CompanyService.registerProjectImages (post-migration)", () => {
  it("updates project_images in Supabase directly", async () => {
    // This should call Supabase, not fetch — mock fetch to throw so we'd know
    vi.mocked(global.fetch).mockImplementation(() => {
      throw new Error("Should not call fetch for registerProjectImages");
    });

    const mockSb = {
      from: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValueOnce({ error: null }),
    };
    vi.mocked(requireSupabase).mockReturnValue(mockSb as never);

    await expect(
      CompanyService.registerProjectImages("proj-uuid", [
        "https://s3.amazonaws.com/bucket/projects/proj-uuid/img1.jpg",
      ])
    ).resolves.not.toThrow();
  });
});
