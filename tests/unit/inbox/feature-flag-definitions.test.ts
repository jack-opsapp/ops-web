/**
 * Unit tests: feature-flag-definitions helpers
 *
 * Verifies that the stale portal→/inbox mapping has been removed, and that
 * getSlugForRoute resolves /inbox (and sub-paths) to inbox_ui exclusively.
 */

import { describe, it, expect } from "vitest";
import {
  getSlugForRoute,
  FEATURE_FLAG_ROUTES,
} from "@/lib/feature-flags/feature-flag-definitions";

describe("getSlugForRoute — /inbox", () => {
  it("returns inbox_ui for /inbox", () => {
    expect(getSlugForRoute("/inbox")).toBe("inbox_ui");
  });

  it("returns inbox_ui for a sub-path like /inbox/thread-123", () => {
    expect(getSlugForRoute("/inbox/thread-123")).toBe("inbox_ui");
  });

  it("returns inbox_ui for a deeply nested sub-path", () => {
    expect(getSlugForRoute("/inbox/thread-abc/reply")).toBe("inbox_ui");
  });

  it("does NOT return portal for /inbox (stale mapping removed)", () => {
    expect(getSlugForRoute("/inbox")).not.toBe("portal");
  });
});

describe("FEATURE_FLAG_ROUTES — portal entry", () => {
  it("portal route list does not include /inbox", () => {
    const portalRoutes = FEATURE_FLAG_ROUTES["portal"] ?? [];
    expect(portalRoutes).not.toContain("/inbox");
  });

  it("inbox_ui route list includes /inbox", () => {
    const inboxRoutes = FEATURE_FLAG_ROUTES["inbox_ui"] ?? [];
    expect(inboxRoutes).toContain("/inbox");
  });
});

describe("getSlugForRoute — other routes unaffected", () => {
  it("returns pipeline for /pipeline", () => {
    expect(getSlugForRoute("/pipeline")).toBe("pipeline");
  });

  it("returns null for an ungated route", () => {
    expect(getSlugForRoute("/projects")).toBeNull();
  });

  it("returns null for /portal (no dashboard /portal route is gated)", () => {
    // /portal is in a separate app group, not in FEATURE_FLAG_ROUTES
    expect(getSlugForRoute("/portal")).toBeNull();
  });
});
