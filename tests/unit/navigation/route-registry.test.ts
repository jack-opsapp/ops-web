/**
 * Route registry invariants (WEB OVERHAUL P2).
 *
 * The registry is the single source of truth for nav, titles, route
 * permissions, and full-height modes — these tests pin the invariants the
 * shell relies on, plus behavior parity with the tables it replaced.
 */

import { describe, it, expect } from "vitest";
import {
  ROUTE_REGISTRY,
  getEntryForPath,
  getTitleKeyForPath,
  getPermissionForPath,
  getAnyOfPermissionsForPath,
  getFullHeightMode,
  getNavEntries,
  getNumberShortcutRoutes,
  isNavEntryActive,
} from "@/lib/navigation/route-registry";

import enNavigation from "@/i18n/dictionaries/en/navigation.json";
import esNavigation from "@/i18n/dictionaries/es/navigation.json";

describe("registry shape", () => {
  it("has unique keys, hrefs, and nav orders", () => {
    const keys = ROUTE_REGISTRY.map((e) => e.key);
    const hrefs = ROUTE_REGISTRY.map((e) => e.href);
    const orders = ROUTE_REGISTRY.filter((e) => e.nav !== false).map(
      (e) => (e.nav as { order: number }).order,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("every href is a rooted path without trailing slash", () => {
    for (const e of ROUTE_REGISTRY) {
      expect(e.href.startsWith("/")).toBe(true);
      expect(e.href.length === 1 || !e.href.endsWith("/")).toBe(true);
    }
  });

  it("every labelKey resolves in BOTH en and es navigation dictionaries", () => {
    for (const e of ROUTE_REGISTRY) {
      expect((enNavigation as Record<string, string>)[e.labelKey]).toBeTruthy();
      expect((esNavigation as Record<string, string>)[e.labelKey]).toBeTruthy();
    }
  });

  it("nav entries are ordered with command group before ops group", () => {
    const entries = getNavEntries();
    const lastCommand = entries.reduce(
      (acc, e, i) => (e.nav !== false && e.nav.group === "command" ? i : acc),
      -1,
    );
    const firstOps = entries.findIndex(
      (e) => e.nav !== false && e.nav.group === "ops",
    );
    expect(firstOps).toBeGreaterThan(lastCommand);
  });

  it("phase-C-only entries are exactly calibration and agent-queue", () => {
    const phaseC = ROUTE_REGISTRY.filter((e) => e.phaseCOnly).map((e) => e.key);
    expect(phaseC.sort()).toEqual(["agent-queue", "calibration"]);
  });

  it("inbox is registered but NOT in the nav (shelved per master plan §3)", () => {
    const inbox = ROUTE_REGISTRY.find((e) => e.key === "inbox");
    expect(inbox).toBeDefined();
    expect(inbox?.nav).toBe(false);
  });
});

describe("longest-prefix matching", () => {
  it("picks the most specific entry for /agent/queue over /agent", () => {
    expect(getEntryForPath("/agent/queue")?.key).toBe("agent-queue");
    expect(getEntryForPath("/agent/queue/abc")?.key).toBe("agent-queue");
    expect(getEntryForPath("/agent/other")?.key).toBe("agent");
  });

  it("matches nested paths to their root entry", () => {
    expect(getEntryForPath("/schedule")?.key).toBe("schedule");
    expect(getEntryForPath("/projects/abc-123")?.key).toBe("projects");
    expect(getEntryForPath("/settings/integrations")?.key).toBe("settings");
  });

  it("does not match unrelated prefixes", () => {
    expect(getEntryForPath("/scheduler")).toBeNull();
    expect(getEntryForPath("/unknown")).toBeNull();
  });
});

describe("title resolution (replaces top-bar routeTitles)", () => {
  it.each([
    ["/dashboard", "nav.dashboard"],
    ["/schedule", "nav.schedule"],
    ["/projects", "nav.projects"],
    ["/inbox", "nav.inbox"],
    ["/agent/queue", "nav.agentQueue"],
    ["/calibration", "nav.calibration"],
  ])("%s → %s", (path, key) => {
    expect(getTitleKeyForPath(path)).toBe(key);
  });

  it("returns null for unregistered routes", () => {
    expect(getTitleKeyForPath("/testing-grounds")).toBeNull();
  });
});

describe("nested breadcrumb parent-crumb resolution (top-bar CATALOG // SETUP)", () => {
  // A nested route that owns a registry entry (/catalog/setup) resolves its
  // OWN label on the full path. Deriving the parent crumb from the full path
  // printed the whole entry, then the leaf repeated it → "CATALOG SETUP //
  // SETUP". The top bar now derives the parent crumb from the parent route
  // ("/" + first segment), which yields the parent's own, distinct label so
  // the trail reads "CATALOG // SETUP". This test pins that the two titles
  // are distinct — the invariant the fix depends on.
  it("full-path title is distinct from parent-route title for /catalog/setup", () => {
    expect(getTitleKeyForPath("/catalog/setup")).toBe("nav.catalogSetup");
    expect(getTitleKeyForPath("/catalog")).toBe("nav.catalog");
    expect(getTitleKeyForPath("/catalog/setup")).not.toBe(
      getTitleKeyForPath("/catalog"),
    );
  });

  it("dynamic detail routes keep the parent title from the parent route", () => {
    // /projects/[id] has no registry entry of its own; both the full path and
    // the parent route resolve to the projects title, so the auto-generated
    // crumb stays "PROJECTS // {name}" under the fix (no regression).
    expect(getTitleKeyForPath("/projects/abc-123")).toBe("nav.projects");
    expect(getTitleKeyForPath("/projects")).toBe("nav.projects");
  });
});

describe("route permissions (parity with the retired ROUTE_PERMISSIONS map)", () => {
  it.each([
    ["/projects", "projects.view"],
    ["/schedule", "calendar.view"],
    ["/clients", "clients.view"],
    ["/pipeline", "pipeline.view"],
    ["/catalog/setup", "catalog.run_setup"],
    ["/inbox", "pipeline.view"],
    ["/calibration", "email.configure_ai"],
    ["/agent", "pipeline.view"],
    ["/agent/queue", "pipeline.view"],
  ])("%s requires %s", (path, permission) => {
    expect(getPermissionForPath(path)).toBe(permission);
  });

  it("dashboard and settings are always allowed", () => {
    expect(getPermissionForPath("/dashboard")).toBeNull();
    expect(getPermissionForPath("/settings")).toBeNull();
  });

  // BOOKS (P3.1) absorbed /estimates, /invoices, /accounting — the hub
  // gates on ANY of its segments' permissions (capability inventory §7).
  it("/books is any-of gated across its segments", () => {
    expect(getPermissionForPath("/books")).toBeNull(); // single-permission API
    expect(getAnyOfPermissionsForPath("/books")).toEqual([
      "invoices.view",
      "estimates.view",
      "expenses.approve",
      "accounting.view",
    ]);
  });

  it("/catalog is any-of gated across catalog products and stock", () => {
    expect(getPermissionForPath("/catalog")).toBeNull(); // single-permission API
    expect(getAnyOfPermissionsForPath("/catalog")).toEqual([
      "catalog.products.view",
      "catalog.view",
    ]);
  });

  it("single-permission entries normalize through the any-of helper", () => {
    expect(getAnyOfPermissionsForPath("/pipeline")).toEqual(["pipeline.view"]);
    expect(getAnyOfPermissionsForPath("/dashboard")).toBeNull();
  });

  it("retired financial routes are no longer registered (middleware owns them)", () => {
    expect(getEntryForPath("/estimates")).toBeNull();
    expect(getEntryForPath("/invoices")).toBeNull();
    expect(getEntryForPath("/accounting")).toBeNull();
  });

  // /map, /products, /inventory, /team were absorbed into their hubs
  // (Projects map view, Catalog, Settings → Team) and now 308-redirect via
  // middleware. They are deliberately NOT registered standalone — the
  // destination route owns the permission gate.
  it("absorbed nav routes are no longer registered (middleware redirects them)", () => {
    for (const path of ["/map", "/products", "/inventory", "/team"]) {
      expect(getEntryForPath(path)).toBeNull();
      expect(getPermissionForPath(path)).toBeNull();
    }
  });
});

describe("full-height modes (parity with the retired FULL_HEIGHT_ROUTES map)", () => {
  it.each([
    ["/inbox", "padded"],
    ["/schedule", "padded"],
    ["/pipeline", "bleed"],
    ["/projects", "bleed"],
  ] as const)("%s → %s", (path, mode) => {
    expect(getFullHeightMode(path)).toBe(mode);
  });

  it("/projects/new inherits /projects bleed (hand-off page renders null)", () => {
    // The scrolling-form opt-out is retired with the route consolidation
    // (2026-07-03): /projects/new only dispatches the create window and
    // redirects, so it inherits its ancestor's mode like any sub-route.
    expect(getFullHeightMode("/projects/new")).toBe("bleed");
  });

  it("normal pages get null", () => {
    expect(getFullHeightMode("/dashboard")).toBeNull();
    expect(getFullHeightMode("/settings")).toBeNull();
  });
});

describe("number-key shortcuts derive from nav order", () => {
  it("maps 1..9 to the first nine command-group entries", () => {
    const map = getNumberShortcutRoutes();
    expect(map["1"]).toBe("/dashboard");
    expect(map["2"]).toBe("/projects");
    expect(Object.keys(map).length).toBeLessThanOrEqual(9);
    // Every target is a command-group nav entry, in order.
    const commandHrefs = getNavEntries()
      .filter((e) => e.nav !== false && e.nav.group === "command")
      .map((e) => e.href);
    expect(Object.values(map)).toEqual(commandHrefs.slice(0, 9));
  });
});

describe("active-state matching", () => {
  it("dashboard lights only on exact match", () => {
    const dashboard = ROUTE_REGISTRY.find((e) => e.key === "dashboard")!;
    expect(isNavEntryActive(dashboard, "/dashboard")).toBe(true);
    expect(isNavEntryActive(dashboard, "/dashboard/anything")).toBe(false);
  });

  it("other entries light on nested paths", () => {
    const projects = ROUTE_REGISTRY.find((e) => e.key === "projects")!;
    expect(isNavEntryActive(projects, "/projects/abc")).toBe(true);
    expect(isNavEntryActive(projects, "/pipeline")).toBe(false);
  });
});
