import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyMock, findUserMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  findUserMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserMock,
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
  });
});

describe("agent API actor resolution", () => {
  it("uses only the verified Firebase subject and never mailbox email", async () => {
    const result = await authenticateRequest({} as never);
    expect(findUserMock).toHaveBeenCalledWith(
      "firebase-subject",
      undefined,
      "id, company_id, role"
    );
    expect(result).toMatchObject({ id: "ops-user", companyId: "company-1" });
  });
});
