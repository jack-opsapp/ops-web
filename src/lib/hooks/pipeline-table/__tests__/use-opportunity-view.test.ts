/**
 * Tests for the pipeline active-view resolver.
 *
 * `resolveActiveOpportunityView` is the pure selection core extracted from
 * `useOpportunityView` so its precedence is verifiable without mounting the hook
 * (no router / searchParams / localStorage). It encodes the lean pipeline
 * selection rule — URL id wins over the stored id, either falls back to the
 * default view, and archived/missing ids never resolve. The heavy `?sort=` /
 * `?filter=` URL-override layering the projects table needs is intentionally
 * NOT part of this hook, so there is nothing override-shaped to test here.
 */

import { describe, expect, it } from "vitest";

import { resolveActiveOpportunityView } from "@/lib/hooks/pipeline-table/use-opportunity-view";
import type { OpportunityViewDefinition } from "@/lib/types/pipeline-table";

function makeView(
  overrides: Partial<OpportunityViewDefinition> & { id: string },
): OpportunityViewDefinition {
  return {
    name: overrides.id,
    icon: null,
    permissionKey: null,
    columns: [],
    filters: null,
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: false,
    isArchived: false,
    sortPosition: 0,
    updatedAt: "2026-05-31T12:00:00.000Z",
    ...overrides,
  };
}

const defaultView = makeView({ id: "default", isDefault: true, sortPosition: 1 });
const personalView = makeView({ id: "personal", sortPosition: 2 });
const otherView = makeView({ id: "other", sortPosition: 3 });
const views = [defaultView, personalView, otherView];

describe("resolveActiveOpportunityView", () => {
  it("prefers the URL view id over the stored id when it is available", () => {
    const result = resolveActiveOpportunityView(views, "personal", "other");
    expect(result?.id).toBe("personal");
  });

  it("falls back to the stored id when no URL id is present", () => {
    const result = resolveActiveOpportunityView(views, null, "other");
    expect(result?.id).toBe("other");
  });

  it("falls back to the default view when the URL id is not available", () => {
    const result = resolveActiveOpportunityView(views, "missing", "personal");
    expect(result?.id).toBe("default");
  });

  it("falls back to the default view when the stored id is not available", () => {
    const result = resolveActiveOpportunityView(views, null, "missing");
    expect(result?.id).toBe("default");
  });

  it("falls back to the default view when neither id is provided", () => {
    const result = resolveActiveOpportunityView(views, null, null);
    expect(result?.id).toBe("default");
  });

  it("ignores an archived view referenced by id and falls back to the default", () => {
    const archived = makeView({ id: "archived", isArchived: true });
    const withArchived = [defaultView, archived];
    expect(resolveActiveOpportunityView(withArchived, "archived", null)?.id).toBe(
      "default",
    );
    expect(resolveActiveOpportunityView(withArchived, null, "archived")?.id).toBe(
      "default",
    );
  });

  it("uses the first view as the fallback when no view is flagged default", () => {
    const noDefault = [
      makeView({ id: "first", sortPosition: 1 }),
      makeView({ id: "second", sortPosition: 2 }),
    ];
    expect(resolveActiveOpportunityView(noDefault, null, null)?.id).toBe("first");
  });

  it("returns null when there are no views to resolve against", () => {
    expect(resolveActiveOpportunityView([], "anything", "stored")).toBeNull();
  });
});
