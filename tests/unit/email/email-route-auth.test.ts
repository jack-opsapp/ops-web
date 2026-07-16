import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyAdminAuthMock, findUserByAuthMock, checkPermissionByIdMock } =
  vi.hoisted(() => ({
    verifyAdminAuthMock: vi.fn(),
    findUserByAuthMock: vi.fn(),
    checkPermissionByIdMock: vi.fn(),
  }));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

import {
  emailPipelineAuthorizationHeaders,
  requireEmailCompanyAccess,
  requireEmailPipelineSecret,
} from "@/lib/email/email-route-auth";

function request(authorization?: string): NextRequest {
  return new NextRequest("https://ops.test/api/integrations/email/import", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("email pipeline route authorization", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    checkPermissionByIdMock.mockResolvedValue(true);
    process.env.CRON_SECRET = "pipeline-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects browser operations without a verified user", async () => {
    verifyAdminAuthMock.mockResolvedValue(null);

    const response = await requireEmailCompanyAccess(request(), "company-1");

    expect(response?.status).toBe(401);
    expect(findUserByAuthMock).not.toHaveBeenCalled();
  });

  it("rejects a verified user from another company", async () => {
    verifyAdminAuthMock.mockResolvedValue({
      uid: "firebase-user",
      email: "operator@example.com",
      claims: {},
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-2",
      is_active: true,
    });

    const response = await requireEmailCompanyAccess(
      request("Bearer firebase-token"),
      "company-1"
    );

    expect(response?.status).toBe(403);
    expect(checkPermissionByIdMock).not.toHaveBeenCalled();
  });

  it("rejects same-company members without integration-management permission", async () => {
    verifyAdminAuthMock.mockResolvedValue({
      uid: "firebase-user",
      email: "operator@example.com",
      claims: {},
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      is_active: true,
    });
    checkPermissionByIdMock.mockResolvedValue(false);

    const response = await requireEmailCompanyAccess(
      request("Bearer firebase-token"),
      "company-1"
    );

    expect(response?.status).toBe(403);
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      "user-1",
      "settings.integrations"
    );
  });

  it("allows a verified user only for their own company", async () => {
    verifyAdminAuthMock.mockResolvedValue({
      uid: "firebase-user",
      email: "operator@example.com",
      claims: {},
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      is_active: true,
    });

    await expect(
      requireEmailCompanyAccess(request("Bearer firebase-token"), "company-1")
    ).resolves.toBeNull();
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      "user-1",
      "settings.integrations"
    );
  });

  it("enforces the operation-specific permission supplied by a pipeline route", async () => {
    verifyAdminAuthMock.mockResolvedValue({
      uid: "firebase-user",
      email: "operator@example.com",
      claims: {},
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      is_active: true,
    });

    await expect(
      requireEmailCompanyAccess(
        request("Bearer firebase-token"),
        "company-1",
        "inbox.categorize"
      )
    ).resolves.toBeNull();
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      "user-1",
      "inbox.categorize"
    );
  });

  it("rejects a same-company caller targeting another user's mailbox data", async () => {
    verifyAdminAuthMock.mockResolvedValue({
      uid: "firebase-user",
      email: "operator@example.com",
      claims: {},
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      is_active: true,
    });

    const response = await requireEmailCompanyAccess(
      request("Bearer firebase-token"),
      "company-1",
      "inbox.send",
      "user-2"
    );

    expect(response?.status).toBe(403);
    expect(checkPermissionByIdMock).not.toHaveBeenCalled();
  });

  it.each([false, null])(
    "rejects a cryptographically resolved user whose active state is %s",
    async (isActive) => {
      verifyAdminAuthMock.mockResolvedValue({
        uid: "firebase-user",
        email: "operator@example.com",
        claims: {},
      });
      findUserByAuthMock.mockResolvedValue({
        id: "user-1",
        company_id: "company-1",
        is_active: isActive,
      });

      const response = await requireEmailCompanyAccess(
        request("Bearer firebase-token"),
        "company-1"
      );

      expect(response?.status).toBe(403);
      expect(checkPermissionByIdMock).not.toHaveBeenCalled();
    }
  );

  it("fails closed when the server-to-server secret is absent", () => {
    delete process.env.CRON_SECRET;

    const response = requireEmailPipelineSecret(request());

    expect(response?.status).toBe(500);
    expect(() => emailPipelineAuthorizationHeaders()).toThrow(
      "CRON_SECRET is required"
    );
  });

  it("rejects an invalid pipeline secret and emits the exact valid header", () => {
    expect(
      requireEmailPipelineSecret(request("Bearer wrong-secret"))?.status
    ).toBe(401);

    const headers = emailPipelineAuthorizationHeaders();
    expect(headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer pipeline-secret",
    });
    expect(
      requireEmailPipelineSecret(request(headers.Authorization))
    ).toBeNull();
  });
});
