import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyMock, findUserMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  findUserMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserMock,
}));
vi.mock("@/lib/api/services/company-managers", () => ({
  getCompanyManagerUserIds: vi.fn(async () => ["ops-user"]),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: vi.fn(() => ({})),
}));

import { authenticateRequest } from "@/app/api/agent/_lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockResolvedValue({
    uid: "firebase-subject",
    email: "mailbox-address@example.com",
  });
  findUserMock.mockResolvedValue({
    id: "ops-user",
    company_id: "company-1",
    role: "operator",
    is_active: true,
    first_name: "Jason",
    last_name: "Zavarella",
  });
});

describe("agent API actor resolution", () => {
  it("uses only the verified Firebase subject and never mailbox email", async () => {
    const result = await authenticateRequest({} as never);
    expect(findUserMock).toHaveBeenCalledWith(
      "firebase-subject",
      undefined,
      "id, company_id, role, is_active, first_name, last_name"
    );
    expect(result).toMatchObject({
      id: "ops-user",
      companyId: "company-1",
      isManager: true,
      firstName: "Jason",
      lastName: "Zavarella",
    });
  });

  it("rejects an inactive OPS user even when the Firebase token is valid", async () => {
    findUserMock.mockResolvedValue({
      id: "ops-user",
      company_id: "company-1",
      role: "operator",
      is_active: false,
    });

    const result = await authenticateRequest({} as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });
});
