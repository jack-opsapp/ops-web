/**
 * Integration tests for POST /api/uploads/presign (presign flow only)
 *
 * Covers:
 *   - Image content-types are allowed for any folder (existing behavior).
 *   - `application/json` is allowed when folder begins with `training_data/`
 *     (deck-scanner cleanup-edit log path — iOS commit 9dffeb7 on
 *     `claude/deck-scanner-rebuild`).
 *   - `application/json` is REJECTED for non-training-data folders.
 *   - Disallowed image-ish types (e.g. `image/gif`) are rejected.
 *   - Missing `filename` / `contentType` returns 400.
 *   - File extension is inferred from contentType when filename has no
 *     extension (JSON → `.json`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the path passed to createSignedUploadUrl so we can assert on
// extension inference.
let capturedPath = "";

// ─── Supabase service-role client mock ──────────────────────────────────────
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    storage: {
      from: (_bucket: string) => ({
        createSignedUploadUrl: async (path: string) => {
          capturedPath = path;
          return {
            data: {
              signedUrl: `https://example.supabase.co/storage/v1/upload/sign/${path}?token=test`,
              token: "test",
              path,
            },
            error: null,
          };
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://example.supabase.co/storage/v1/object/public/images/${path}`,
          },
        }),
      }),
    },
  }),
}));

// Import AFTER mocks are registered so the route picks up the stub.
import { POST } from "@/app/api/uploads/presign/route";

function makePresignRequest(params: Record<string, string>): Request {
  const body = new URLSearchParams(params).toString();
  return new Request("http://localhost/api/uploads/presign", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

describe("POST /api/uploads/presign — presign (iOS) flow", () => {
  beforeEach(() => {
    capturedPath = "";
  });

  describe("content-type validation", () => {
    it("allows image/jpeg for an arbitrary image folder", async () => {
      const req = makePresignRequest({
        filename: "shot.jpg",
        contentType: "image/jpeg",
        folder: "projects/co_123/proj_456",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { uploadUrl: string; publicUrl: string };
      expect(json.uploadUrl).toContain("/upload/sign/");
      expect(json.publicUrl).toContain("/object/public/images/");
      expect(capturedPath).toMatch(/^projects\/co_123\/proj_456\/\d+-[a-z0-9]+\.jpg$/);
    });

    it("allows application/json for the training_data/ folder prefix", async () => {
      const req = makePresignRequest({
        filename: "entry_abc123.json",
        contentType: "application/json",
        folder: "training_data/deck_scanner/co_123/usr_456/2026-04-29",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { uploadUrl: string; publicUrl: string };
      expect(json.uploadUrl).toContain("/upload/sign/");
      expect(capturedPath).toMatch(
        /^training_data\/deck_scanner\/co_123\/usr_456\/2026-04-29\/\d+-[a-z0-9]+\.json$/
      );
    });

    it("rejects application/json when folder is NOT training_data/", async () => {
      const req = makePresignRequest({
        filename: "payload.json",
        contentType: "application/json",
        folder: "projects/co_123/proj_456",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toMatch(/Invalid content type/i);
    });

    it("rejects image/gif everywhere (not on the allowlist)", async () => {
      const req = makePresignRequest({
        filename: "shot.gif",
        contentType: "image/gif",
        folder: "training_data/deck_scanner/co_123/usr_456/2026-04-29",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(400);
    });

    it("rejects application/javascript even when path is training_data/", async () => {
      const req = makePresignRequest({
        filename: "evil.js",
        contentType: "application/javascript",
        folder: "training_data/deck_scanner/co_123/usr_456/2026-04-29",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(400);
    });
  });

  describe("required fields", () => {
    it("returns 400 when filename is missing", async () => {
      const req = makePresignRequest({
        contentType: "image/jpeg",
        folder: "projects/co_123/proj_456",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(400);
    });

    it("returns 400 when contentType is missing", async () => {
      const req = makePresignRequest({
        filename: "shot.jpg",
        folder: "projects/co_123/proj_456",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(400);
    });
  });

  describe("file extension inference", () => {
    it("preserves the original extension when present", async () => {
      const req = makePresignRequest({
        filename: "entry_abc.json",
        contentType: "application/json",
        folder: "training_data/deck_scanner/co_123/usr_456/2026-04-29",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(200);
      expect(capturedPath.endsWith(".json")).toBe(true);
    });

    it("falls back to .json when filename has no extension and type is JSON", async () => {
      const req = makePresignRequest({
        filename: "entry_abc",
        contentType: "application/json",
        folder: "training_data/deck_scanner/co_123/usr_456/2026-04-29",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(200);
      expect(capturedPath.endsWith(".json")).toBe(true);
    });

    it("falls back to .jpg when filename has no extension and type is image", async () => {
      const req = makePresignRequest({
        filename: "shot",
        contentType: "image/jpeg",
        folder: "projects/co_123/proj_456",
      });
      const res = await POST(req as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(200);
      expect(capturedPath.endsWith(".jpg")).toBe(true);
    });
  });
});
