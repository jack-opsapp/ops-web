import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookieGetMock,
  verifyAuthTokenMock,
  findUserByAuthMock,
  checkPermissionByIdMock,
  resolveEmailOAuthAlertConnectionMock,
  companyMaybeSingleMock,
  fromMock,
} = vi.hoisted(() => ({
  cookieGetMock: vi.fn(),
  verifyAuthTokenMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  checkPermissionByIdMock: vi.fn(),
  resolveEmailOAuthAlertConnectionMock: vi.fn(),
  companyMaybeSingleMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: fromMock }),
}));
vi.mock("@/lib/email/email-oauth-state", () => ({
  resolveEmailOAuthAlertConnection: resolveEmailOAuthAlertConnectionMock,
}));

import ReconnectInboxPage from "@/app/(auth)/reconnect-inbox/page";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const USER_ID = "956263ff-b40e-4e8e-8341-cfcad966e207";
const CONNECTION_ID = "5dd46693-f736-4732-bc81-d01a5d687c89";
const EXPECTED_EMAIL = "crew@canpro.test";

function props() {
  return {
    searchParams: Promise.resolve({
      companyId: COMPANY_ID,
      userId: USER_ID,
      type: "company",
      provider: "gmail",
      connectionId: CONNECTION_ID,
      expectedEmail: EXPECTED_EMAIL,
    }),
  };
}

describe("reconnect inbox alert authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGetMock.mockImplementation((name: string) =>
      name === "ops-auth-token" ? { value: "firebase-token" } : undefined
    );
    verifyAuthTokenMock.mockResolvedValue({
      uid: "firebase-user",
      email: "owner@canpro.test",
      claims: {},
    });
    findUserByAuthMock.mockResolvedValue({
      id: USER_ID,
      company_id: COMPANY_ID,
      first_name: "Jackson",
      last_name: "Sweet",
      email: "owner@canpro.test",
    });
    checkPermissionByIdMock.mockResolvedValue(true);
    resolveEmailOAuthAlertConnectionMock.mockResolvedValue({
      connectionId: CONNECTION_ID,
      expectedEmail: EXPECTED_EMAIL,
    });
    companyMaybeSingleMock.mockResolvedValue({
      data: { id: COMPANY_ID, name: "Canpro" },
      error: null,
    });
    fromMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: companyMaybeSingleMock })),
      })),
    });
  });

  it("sends a logged-out alert recipient through login before reading tenant identity", async () => {
    cookieGetMock.mockReturnValue(undefined);

    await expect(ReconnectInboxPage(props())).rejects.toThrow(
      /^redirect:\/login\?redirect=/
    );
    expect(verifyAuthTokenMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects a different OPS user before provider consent", async () => {
    findUserByAuthMock.mockResolvedValueOnce({
      id: "different-user",
      company_id: COMPANY_ID,
    });

    await expect(ReconnectInboxPage(props())).rejects.toThrow(
      "redirect:/settings?tab=integrations"
    );
    expect(checkPermissionByIdMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("renders only for the exact permitted company user", async () => {
    const result = await ReconnectInboxPage(props());

    expect(findUserByAuthMock).toHaveBeenCalledWith(
      "firebase-user",
      "owner@canpro.test",
      "id, company_id, first_name, last_name, email"
    );
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      USER_ID,
      "settings.integrations"
    );
    expect(result.props).toEqual(
      expect.objectContaining({
        companyId: COMPANY_ID,
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        expectedEmail: EXPECTED_EMAIL,
        companyName: "Canpro",
        userName: "Jackson Sweet",
      })
    );
    expect(resolveEmailOAuthAlertConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: fromMock }),
      {
        companyId: COMPANY_ID,
        provider: "gmail",
        type: "company",
        connectionId: CONNECTION_ID,
        expectedEmail: EXPECTED_EMAIL,
      }
    );
  });

  it("rejects an altered or stale connection binding before showing tenant identity", async () => {
    resolveEmailOAuthAlertConnectionMock.mockResolvedValueOnce(null);

    await expect(ReconnectInboxPage(props())).rejects.toThrow(
      "redirect:/settings?tab=integrations"
    );
    expect(fromMock).not.toHaveBeenCalled();
  });
});
