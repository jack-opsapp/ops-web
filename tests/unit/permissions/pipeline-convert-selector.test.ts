import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchUserPermissions = vi.hoisted(() => vi.fn());
const fetchUserOverrides = vi.hoisted(() => vi.fn());
const fetchUser = vi.hoisted(() => vi.fn());
const fetchCompany = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  currentUser: null as {
    id: string;
    companyId?: string | null;
    isCompanyAdmin?: boolean;
    role?: string;
  } | null,
  company: null as {
    id?: string;
    accountHolderId?: string | null;
    adminIds?: string[];
  } | null,
  role: "unassigned",
}));

vi.mock("@/lib/api/services/roles-service", () => ({
  RolesService: {
    fetchUserPermissions,
    fetchUserOverrides,
  },
}));

vi.mock("@/lib/api/services/user-service", () => ({
  UserService: { fetchUser },
}));

vi.mock("@/lib/api/services/company-service", () => ({
  CompanyService: { fetchCompany },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: {
    getState: () => authState,
    setState: (next: Partial<typeof authState>) =>
      Object.assign(authState, next),
  },
}));

const {
  selectCanConvertOpportunity,
  selectCanEditOpportunity,
  usePermissionStore,
} = await import("@/lib/store/permissions-store");

async function load(
  rolePermissions: Array<[string, "all" | "assigned" | "own"]>,
  overrides: Array<{
    permission: string;
    scope: "all" | "assigned" | "own" | null;
    granted: boolean;
  }> = []
) {
  fetchUserPermissions.mockResolvedValue({
    permissions: new Map(rolePermissions),
    roleId: "role-1",
    roleName: "Role",
  });
  fetchUserOverrides.mockResolvedValue(overrides);
  await usePermissionStore.getState().fetchPermissions("user-1");
  return usePermissionStore.getState();
}

describe("selectCanConvertOpportunity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionStore.getState().clear();
    authState.currentUser = {
      id: "user-1",
      companyId: "company-1",
      isCompanyAdmin: false,
      role: "operator",
    };
    authState.company = {
      id: "company-1",
      accountHolderId: "owner-1",
      adminIds: [],
    };
    fetchUser.mockImplementation(async () => ({ ...authState.currentUser }));
    fetchCompany.mockImplementation(async () => ({ ...authState.company }));
  });

  it("allows an explicit assigned convert role grant", async () => {
    const state = await load([["pipeline.convert", "assigned"]]);

    expect(state.configuredPermissions).toContain("pipeline.convert");
    expect(selectCanConvertOpportunity(state)).toBe(true);
  });

  it("does not let legacy manage widen an explicit granular revoke", async () => {
    const state = await load(
      [
        ["pipeline.convert", "assigned"],
        ["pipeline.manage", "all"],
      ],
      [{ permission: "pipeline.convert", scope: null, granted: false }]
    );

    expect(state.configuredPermissions).toContain("pipeline.convert");
    expect(state.permissions.has("pipeline.convert")).toBe(false);
    expect(selectCanConvertOpportunity(state)).toBe(false);
  });

  it("treats an inert granular override as configured and blocks legacy widening", async () => {
    const state = await load(
      [["pipeline.manage", "all"]],
      [{ permission: "pipeline.convert", scope: null, granted: true }]
    );

    expect(state.configuredPermissions).toContain("pipeline.convert");
    expect(state.permissions.has("pipeline.convert")).toBe(false);
    expect(selectCanConvertOpportunity(state)).toBe(false);
  });

  it("uses legacy all-scope manage only when granular convert is genuinely absent", async () => {
    const state = await load([["pipeline.manage", "all"]]);

    expect(state.configuredPermissions).not.toContain("pipeline.convert");
    expect(selectCanConvertOpportunity(state)).toBe(true);
  });

  it("allows an explicit assigned edit role grant", async () => {
    const state = await load([["pipeline.edit", "assigned"]]);

    expect(state.configuredPermissions).toContain("pipeline.edit");
    expect(selectCanEditOpportunity(state)).toBe(true);
  });

  it("does not let legacy manage widen an explicit granular edit revoke", async () => {
    const state = await load(
      [
        ["pipeline.edit", "assigned"],
        ["pipeline.manage", "all"],
      ],
      [{ permission: "pipeline.edit", scope: null, granted: false }]
    );

    expect(state.configuredPermissions).toContain("pipeline.edit");
    expect(state.permissions.has("pipeline.edit")).toBe(false);
    expect(selectCanEditOpportunity(state)).toBe(false);
  });

  it("uses legacy all-scope manage only when granular edit is genuinely absent", async () => {
    const state = await load([["pipeline.manage", "all"]]);

    expect(state.configuredPermissions).not.toContain("pipeline.edit");
    expect(selectCanEditOpportunity(state)).toBe(true);
  });

  it("keeps the admin bypass explicitly granular", async () => {
    authState.currentUser = {
      id: "user-1",
      companyId: "company-1",
      isCompanyAdmin: true,
      role: "admin",
    };
    const state = await load([]);

    expect(state.configuredPermissions).toContain("pipeline.convert");
    expect(state.permissions.get("pipeline.convert")).toBe("all");
    expect(selectCanConvertOpportunity(state)).toBe(true);
    expect(fetchUserPermissions).not.toHaveBeenCalled();
  });

  it("clears configured provenance on logout and failed refresh", async () => {
    await load([["pipeline.convert", "assigned"]]);
    expect(usePermissionStore.getState().configuredPermissions.size).toBe(1);

    usePermissionStore.getState().clear();
    expect(usePermissionStore.getState().configuredPermissions.size).toBe(0);

    fetchUserPermissions.mockRejectedValueOnce(new Error("offline"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await usePermissionStore.getState().fetchPermissions("user-1");

    expect(usePermissionStore.getState().configuredPermissions.size).toBe(0);
    errorSpy.mockRestore();
  });

  it("fails closed when authoritative override provenance cannot be loaded", async () => {
    fetchUserPermissions.mockResolvedValue({
      permissions: new Map([["pipeline.manage", "all"]]),
      roleId: "role-1",
      roleName: "Legacy role",
    });
    fetchUserOverrides.mockRejectedValue(new Error("override read failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await usePermissionStore.getState().fetchPermissions("user-1");
    const state = usePermissionStore.getState();

    expect(state.permissions.size).toBe(0);
    expect(state.configuredPermissions.size).toBe(0);
    expect(selectCanConvertOpportunity(state)).toBe(false);
    expect(selectCanEditOpportunity(state)).toBe(false);
    errorSpy.mockRestore();
  });
});
