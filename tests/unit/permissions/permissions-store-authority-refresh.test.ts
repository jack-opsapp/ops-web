import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@/lib/types/models";

const fetchUser = vi.hoisted(() => vi.fn());
const fetchCompany = vi.hoisted(() => vi.fn());
const fetchUserPermissions = vi.hoisted(() => vi.fn());
const fetchUserOverrides = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  currentUser: null as {
    id: string;
    companyId: string | null;
    isCompanyAdmin: boolean;
    role: UserRole;
  } | null,
  company: null as {
    id: string;
    accountHolderId: string | null;
    adminIds: string[];
  } | null,
  role: "unassigned" as UserRole,
}));
const setAuthState = vi.hoisted(() =>
  vi.fn((next: Partial<typeof authState>) => Object.assign(authState, next))
);

vi.mock("@/lib/api/services/user-service", () => ({
  UserService: { fetchUser },
}));

vi.mock("@/lib/api/services/company-service", () => ({
  CompanyService: { fetchCompany },
}));

vi.mock("@/lib/api/services/roles-service", () => ({
  RolesService: {
    fetchUserPermissions,
    fetchUserOverrides,
  },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: {
    getState: () => authState,
    setState: setAuthState,
  },
}));

const { usePermissionStore } = await import("@/lib/store/permissions-store");

const USER_ID = "user-1";
const COMPANY_ID = "company-1";

function user(isCompanyAdmin: boolean) {
  return {
    id: USER_ID,
    companyId: COMPANY_ID,
    isCompanyAdmin,
    role: UserRole.Operator,
  } as never;
}

function company(input: {
  accountHolderId: string | null;
  adminIds: string[];
}) {
  return {
    id: COMPANY_ID,
    ...input,
  } as never;
}

function seedStaleFullAccess(input: {
  isCompanyAdmin?: boolean;
  accountHolderId?: string | null;
  adminIds?: string[];
}) {
  Object.assign(authState, {
    currentUser: user(input.isCompanyAdmin ?? false),
    company: company({
      accountHolderId: input.accountHolderId ?? "other-holder",
      adminIds: input.adminIds ?? [],
    }),
    role: UserRole.Admin,
  });
  usePermissionStore.setState({
    permissions: new Map([
      ["pipeline.view", "all"],
      ["settings.billing", "all"],
    ]),
    configuredPermissions: new Set(["pipeline.view", "settings.billing"]),
    roleId: "00000000-0000-0000-0000-000000000001",
    roleName: "Admin",
    initialized: true,
    loading: false,
  });
}

describe("PermissionStore canonical authority refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionStore.getState().clear();
    Object.assign(authState, {
      currentUser: null,
      company: null,
      role: UserRole.Unassigned,
    });

    fetchUser.mockResolvedValue(user(false));
    fetchCompany.mockResolvedValue(
      company({ accountHolderId: "other-holder", adminIds: [] })
    );
    fetchUserPermissions.mockResolvedValue({
      permissions: new Map([["pipeline.view", "assigned"]]),
      roleId: "operator-role",
      roleName: "Operator",
    });
    fetchUserOverrides.mockResolvedValue([]);
  });

  it.each([
    {
      source: "is_company_admin",
      stale: { isCompanyAdmin: true },
    },
    {
      source: "account_holder_id",
      stale: { accountHolderId: USER_ID },
    },
    {
      source: "admin_ids",
      stale: { adminIds: [USER_ID] },
    },
  ])(
    "does not re-grant all after $source removes the current user's authority",
    async ({ stale }) => {
      seedStaleFullAccess(stale);

      await usePermissionStore.getState().fetchPermissions(USER_ID);

      const permissionState = usePermissionStore.getState();
      expect(fetchUser).toHaveBeenCalledWith(USER_ID);
      expect(fetchCompany).toHaveBeenCalledWith(COMPANY_ID);
      expect(fetchUserPermissions).toHaveBeenCalledWith(USER_ID);
      expect(permissionState.permissions.get("pipeline.view")).toBe("assigned");
      expect(permissionState.permissions.has("settings.billing")).toBe(false);
      expect(permissionState.roleId).toBe("operator-role");
      expect(authState.currentUser?.isCompanyAdmin).toBe(false);
      expect(authState.company?.accountHolderId).toBe("other-holder");
      expect(authState.company?.adminIds).toEqual([]);
    }
  );

  it("redacts stale full access synchronously while canonical authority reloads", async () => {
    seedStaleFullAccess({ isCompanyAdmin: true });
    let resolveUser!: (value: ReturnType<typeof user>) => void;
    fetchUser.mockReturnValue(
      new Promise<ReturnType<typeof user>>((resolve) => {
        resolveUser = resolve;
      })
    );

    const refresh = usePermissionStore.getState().fetchPermissions(USER_ID);
    const immediateState = usePermissionStore.getState();
    resolveUser(user(false));
    await refresh;

    expect(immediateState.loading).toBe(true);
    expect(immediateState.permissions.size).toBe(0);
    expect(immediateState.configuredPermissions.size).toBe(0);
    expect(usePermissionStore.getState().permissions.get("pipeline.view")).toBe(
      "assigned"
    );
  });

  it("does not let an older canonical refresh overwrite a newer revocation", async () => {
    seedStaleFullAccess({ isCompanyAdmin: true });
    let resolveOlderUser!: (value: ReturnType<typeof user>) => void;
    fetchUser
      .mockReturnValueOnce(
        new Promise<ReturnType<typeof user>>((resolve) => {
          resolveOlderUser = resolve;
        })
      )
      .mockResolvedValueOnce(user(false));

    const olderRefresh = usePermissionStore
      .getState()
      .fetchPermissions(USER_ID);
    await vi.waitFor(() => expect(fetchUser).toHaveBeenCalledTimes(1));

    await usePermissionStore.getState().fetchPermissions(USER_ID);
    expect(usePermissionStore.getState().permissions.get("pipeline.view")).toBe(
      "assigned"
    );

    resolveOlderUser(user(true));
    await olderRefresh;

    expect(usePermissionStore.getState().permissions.get("pipeline.view")).toBe(
      "assigned"
    );
    expect(
      usePermissionStore.getState().permissions.has("settings.billing")
    ).toBe(false);
    expect(authState.currentUser?.isCompanyAdmin).toBe(false);
  });

  it.each([
    {
      source: "user",
      fail: () => fetchUser.mockRejectedValue(new Error("user refresh failed")),
    },
    {
      source: "company",
      fail: () =>
        fetchCompany.mockRejectedValue(new Error("company refresh failed")),
    },
  ])(
    "fails closed when the canonical $source authority refresh fails",
    async ({ fail }) => {
      seedStaleFullAccess({ isCompanyAdmin: true });
      fail();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await usePermissionStore.getState().fetchPermissions(USER_ID);

      const state = usePermissionStore.getState();
      expect(state.permissions.size).toBe(0);
      expect(state.configuredPermissions.size).toBe(0);
      expect(state.roleId).toBeNull();
      expect(fetchUserPermissions).not.toHaveBeenCalled();
      expect(fetchUserOverrides).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    }
  );
});
