/**
 * site_visits.capture registration (CREW SITE VISITS P1).
 *
 * The DB grants `site_visits.capture` ("Start site visits", scope all) to the
 * Admin / Owner / Office / Operator / Crew presets, lists it in
 * private.lead_permission_editor_registry and in
 * feature_flags('pipeline').permissions. The web registry must mirror all
 * three:
 *  - ALL_PERMISSIONS — account holders and company admins derive their grants
 *    from it, so an unregistered DB bit is silently denied to the owner;
 *  - PERMISSION_EDITOR_REGISTRY — the guarded role-permission replacement
 *    sends the exact registry, so it must match the DB editor registry;
 *  - FEATURE_FLAG_PERMISSIONS.pipeline — walk-up site visits ride the
 *    pipeline feature, exactly as the DB flag row lists it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PERMISSION_EDITOR_REGISTRY,
  getModuleForPermission,
  getModuleLabel,
  getPermissionLabel,
  getPermissionScopes,
} from "@/lib/types/permissions";
import {
  FEATURE_FLAG_PERMISSIONS,
  getSlugForPermission,
} from "@/lib/feature-flags/feature-flag-definitions";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

const fetchUser = vi.hoisted(() => vi.fn());
const fetchCompany = vi.hoisted(() => vi.fn());
const fetchUserPermissions = vi.hoisted(() => vi.fn());
const fetchUserOverrides = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/user-service", () => ({
  UserService: { fetchUser },
}));

vi.mock("@/lib/api/services/company-service", () => ({
  CompanyService: { fetchCompany },
}));

vi.mock("@/lib/api/services/roles-service", () => ({
  RolesService: { fetchUserPermissions, fetchUserOverrides },
}));

const PERMISSION = "site_visits.capture";

function readSettingsDictionary(locale: "en" | "es"): Record<string, string> {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), "src/i18n/dictionaries", locale, "settings.json"),
      "utf8"
    )
  ) as Record<string, string>;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePermissionStore.getState().clear();
  useAuthStore.setState({
    company: null,
    currentUser: null,
    isAuthenticated: false,
  });
});

describe("site_visits.capture registration", () => {
  it("registers the permission in ALL_PERMISSIONS exactly once", () => {
    expect(ALL_PERMISSIONS.filter((id) => id === PERMISSION)).toHaveLength(1);
  });

  it("is an editable registry entry labelled 'Start site visits' with scope all only", () => {
    const entry = PERMISSION_EDITOR_REGISTRY.find(
      (action) => action.id === PERMISSION
    );
    expect(entry).toEqual({
      id: PERMISSION,
      label: "Start site visits",
      scopes: ["all"],
    });
    expect(getPermissionLabel(PERMISSION)).toBe("Start site visits");
    expect(getPermissionScopes(PERMISSION)).toEqual(["all"]);
  });

  it("keeps the editor registry sorted by id (the guarded replacement compares index by index)", () => {
    const ids = PERMISSION_EDITOR_REGISTRY.map((action) => action.id);
    expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right)));
  });

  it("lives in its own Site Visits module, right after Pipeline", () => {
    expect(getModuleForPermission(PERMISSION)).toBe("site_visits");
    expect(getModuleLabel("site_visits")).toBe("Site Visits");

    const category = PERMISSION_CATEGORIES.find((candidate) =>
      candidate.modules.some((module) => module.id === "site_visits")
    );
    expect(category?.id).toBe("financial");
    const moduleIds = category?.modules.map((module) => module.id) ?? [];
    expect(moduleIds.indexOf("site_visits")).toBe(
      moduleIds.indexOf("pipeline") + 1
    );

    const siteVisits = category?.modules.find(
      (module) => module.id === "site_visits"
    );
    // One all-scope action: a tier row would offer a "View Only" segment that
    // grants nothing, so the module edits per action (None / All).
    expect(siteVisits).toEqual({
      id: "site_visits",
      label: "Site Visits",
      editorMode: "action",
      actions: [
        { id: PERMISSION, label: "Start site visits", scopes: ["all"] },
      ],
    });
  });

  it("is gated by the pipeline feature flag, mirroring feature_flags('pipeline').permissions", () => {
    expect(FEATURE_FLAG_PERMISSIONS.pipeline).toContain(PERMISSION);
    expect(getSlugForPermission(PERMISSION)).toBe("pipeline");
    const gatingSlugs = Object.entries(FEATURE_FLAG_PERMISSIONS)
      .filter(([, permissions]) => permissions.includes(PERMISSION))
      .map(([slug]) => slug);
    expect(gatingSlugs).toEqual(["pipeline"]);
  });

  it("carries localized module and action labels for the action-level editor", () => {
    const en = readSettingsDictionary("en");
    const es = readSettingsDictionary("es");

    expect(en["roles.permissionModule.site_visits"]).toBe("Site Visits");
    expect(en["roles.permissionAction.site_visits.capture"]).toBe(
      "Start site visits"
    );
    expect(es["roles.permissionModule.site_visits"]).toBe("Visitas al sitio");
    expect(es["roles.permissionAction.site_visits.capture"]).toBe(
      "Iniciar visitas al sitio"
    );
  });

  it("grants the permission to account holders and company admins through the admin bypass", async () => {
    const cases = [
      {
        company: { accountHolderId: "user-account-holder", adminIds: [] },
        userId: "user-account-holder",
      },
      {
        company: {
          accountHolderId: "other-user",
          adminIds: ["user-company-admin"],
        },
        userId: "user-company-admin",
      },
    ];

    for (const testCase of cases) {
      usePermissionStore.getState().clear();
      const canonicalUser = {
        id: testCase.userId,
        companyId: "company-1",
        isCompanyAdmin: false,
        role: "unassigned",
      };
      const canonicalCompany = { id: "company-1", ...testCase.company };
      useAuthStore.setState({
        currentUser: canonicalUser as never,
        company: canonicalCompany as never,
      });
      fetchUser.mockResolvedValue(canonicalUser);
      fetchCompany.mockResolvedValue(canonicalCompany);

      await usePermissionStore.getState().fetchPermissions(testCase.userId);

      expect(usePermissionStore.getState().can(PERMISSION, "all")).toBe(true);
    }
  });
});
