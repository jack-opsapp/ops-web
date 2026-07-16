/**
 * Registry ⊇ DB parity guards.
 *
 * Every permission string granted in the DB must be registered in
 * ALL_PERMISSIONS (the admin bypass grants from the registry, so an
 * unregistered DB string is denied to owners while grantable to crew).
 * The strings asserted here were verified live against role_permissions
 * on 2026-07-03 (BUG BURNDOWN W5). spec.admin is a DELIBERATE exclusion —
 * see the comment above ALL_PERMISSIONS.
 */

import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  getActionsForTier,
  getPermissionScopes,
} from "@/lib/types/permissions";

const NEWLY_REGISTERED = [
  "deck_builder.view",
  "deck_builder.create",
  "deck_builder.edit",
  "projects.view_financials",
  "inventory.manage",
  "finances.view",
  "time_off.approve",
  "profile.edit",
];

describe("permission registry", () => {
  it("registers every live DB permission string", () => {
    for (const id of NEWLY_REGISTERED) {
      expect(ALL_PERMISSIONS, `${id} must be registered`).toContain(id);
    }
  });

  it("never registers spec.admin (bypass would leak the SPEC console)", () => {
    expect(ALL_PERMISSIONS).not.toContain("spec.admin");
  });

  it("has no duplicate permission ids", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("keeps financial visibility out of the projects Manage tier", () => {
    expect(getActionsForTier("projects", "manage")).not.toContain("projects.view_financials");
    expect(getActionsForTier("projects", "full")).toContain("projects.view_financials");
  });

  it("scopes match the live DB shape", () => {
    expect(getPermissionScopes("deck_builder.view")).toEqual(["all", "assigned"]);
    expect(getPermissionScopes("profile.edit")).toEqual(["own"]);
    expect(getPermissionScopes("finances.view")).toEqual(["all"]);
  });

  it("registers independent lead actions with assigned or all scope", () => {
    expect(getPermissionScopes("pipeline.create")).toEqual(["all"]);
    for (const permission of [
      "pipeline.view",
      "pipeline.edit",
      "pipeline.assign",
      "pipeline.convert",
    ]) {
      expect(ALL_PERMISSIONS).toContain(permission);
      expect(getPermissionScopes(permission)).toEqual(["all", "assigned"]);
    }
  });

  it("registers scoped inbox access", () => {
    expect(getPermissionScopes("inbox.view")).toEqual(["all", "assigned", "own"]);
    expect(getPermissionScopes("inbox.send")).toEqual(["all", "assigned"]);
  });

  it("keeps legacy compatibility grants registered but hidden from new editing", () => {
    const modules = PERMISSION_CATEGORIES.flatMap((category) => category.modules);
    const pipeline = modules.find((module) => module.id === "pipeline");
    const inbox = modules.find((module) => module.id === "inbox");

    expect(ALL_PERMISSIONS).toContain("pipeline.manage");
    expect(ALL_PERMISSIONS).toContain("inbox.view_company");
    expect(pipeline?.actions.find((action) => action.id === "pipeline.manage"))
      .toMatchObject({ hiddenFromEditor: true });
    expect(inbox?.actions.find((action) => action.id === "inbox.view_company"))
      .toMatchObject({ hiddenFromEditor: true });
    expect(getActionsForTier("pipeline", "full")).not.toContain("pipeline.manage");
    expect(getActionsForTier("inbox", "full")).not.toContain("inbox.view_company");
  });

  it("uses action-level editing only for Pipeline and Inbox", () => {
    const actionLevelModules = PERMISSION_CATEGORIES.flatMap((category) => category.modules)
      .filter((module) => module.editorMode === "action")
      .map((module) => module.id)
      .sort();

    expect(actionLevelModules).toEqual(["inbox", "pipeline"]);
  });
});
