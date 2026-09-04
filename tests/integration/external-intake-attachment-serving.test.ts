import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { resolveActorMock, rpcMock, signedUrlMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  rpcMock: vi.fn(),
  signedUrlMock: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveActorMock,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: rpcMock }),
}));
vi.mock("@/lib/external-api/uploads/cloudfront-delivery", () => ({
  createExternalAttachmentDeliveryUrl: signedUrlMock,
}));

import { GET } from "@/app/api/opportunities/[id]/intake-attachments/[attachmentId]/route";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT_ID = "22222222-2222-4222-8222-222222222222";

function request(mode = "preview") {
  return new NextRequest(
    `https://ops.example.test/api/opportunities/${OPPORTUNITY_ID}/intake-attachments/${ATTACHMENT_ID}?mode=${mode}`,
    { headers: { authorization: "Bearer firebase" } }
  );
}

function context(id = OPPORTUNITY_ID, attachmentId = ATTACHMENT_ID) {
  return { params: Promise.resolve({ id, attachmentId }) };
}

describe("external intake attachment serving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveActorMock.mockResolvedValue({
      ok: true,
      actor: {
        userId: "33333333-3333-4333-8333-333333333333",
        companyId: "44444444-4444-4444-8444-444444444444",
      },
    });
    signedUrlMock.mockReturnValue({
      url: "https://files.ops.example.test/safe-derivative/image.webp?Signature=x",
      mode: "inline-image",
      expiresAt: "2026-07-26T22:01:00.000Z",
    });
  });

  it("rechecks current lead access and redirects without proxying file bytes", async () => {
    rpcMock.mockResolvedValue({
      data: {
        storage_object_key:
          "safe-derivative/44444444-4444-4444-8444-444444444444/a/image.webp",
        delivery_mode: "inline_image",
        filename: "jobsite.jpg",
      },
      error: null,
    });

    const response = await GET(request(), context());

    expect(rpcMock).toHaveBeenCalledWith(
      "resolve_external_intake_attachment_as_system",
      {
        p_actor_user_id: "33333333-3333-4333-8333-333333333333",
        p_opportunity_id: OPPORTUNITY_ID,
        p_public_upload_id: ATTACHMENT_ID,
        p_mode: "preview",
      }
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "https://files.ops.example.test/"
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("jobsite");
  });

  it.each([
    ["missing", null],
    ["quarantined", null],
    ["rejected", null],
    ["privacy deleted", null],
    ["cross-company mismatch", null],
  ])("returns the same 404 for %s content", async (_label, data) => {
    rpcMock.mockResolvedValue({ data, error: null });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Attachment not found",
    });
  });

  it("never converts a document delivery into an inline preview", async () => {
    rpcMock.mockResolvedValue({
      data: {
        storage_object_key:
          "accepted-original/44444444-4444-4444-8444-444444444444/a/file",
        delivery_mode: "attachment",
        filename: "plans.pdf",
      },
      error: null,
    });

    const response = await GET(request("preview"), context());

    expect(response.status).toBe(404);
    expect(signedUrlMock).not.toHaveBeenCalled();
  });

  it("passes authentication failures through without resolving storage", async () => {
    resolveActorMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails safely when private delivery signing is unavailable", async () => {
    rpcMock.mockResolvedValue({
      data: {
        storage_object_key:
          "safe-derivative/44444444-4444-4444-8444-444444444444/a/image.webp",
        delivery_mode: "inline_image",
        filename: "jobsite.jpg",
      },
      error: null,
    });
    signedUrlMock.mockImplementation(() => {
      throw new Error("attachment_delivery_unavailable");
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Attachment unavailable",
    });
  });
});
