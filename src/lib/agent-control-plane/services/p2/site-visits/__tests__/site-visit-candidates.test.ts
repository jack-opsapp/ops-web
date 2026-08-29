import { describe, expect, it } from "vitest";

import {
  GET_SITE_VISIT_CONTEXT_CANDIDATE,
  LIST_SITE_VISITS_CANDIDATE,
  selectedGetSiteVisitContextVariantKeys,
  selectedListSiteVisitsVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/site-visits";

function policyShape(
  candidate:
    typeof LIST_SITE_VISITS_CANDIDATE | typeof GET_SITE_VISIT_CONTEXT_CANDIDATE
) {
  return candidate.authorization.variants.map((variant) => ({
    key: variant.key,
    oauth: variant.policy.requiredOAuthScopes,
    permissions: variant.policy.permissionRequirementGroups.map((group) =>
      group.map(
        (requirement) =>
          `${requirement.permission}:${requirement.allowedScopes.join(",")}`
      )
    ),
  }));
}

describe("P2 site-visit candidate policies", () => {
  it("adds the dedicated site-visit scope without mutating the frozen v7 permissions", () => {
    expect(policyShape(LIST_SITE_VISITS_CANDIDATE)).toEqual([
      {
        key: "booked_appointments",
        oauth: [
          "ops.customers.read",
          "ops.jobs.read",
          "ops.schedule.read",
          "ops.site_visits.read",
        ],
        permissions: [
          [
            "calendar.view:all,own",
            "clients.view:all,assigned",
            "pipeline.view:all,assigned",
          ],
        ],
      },
      {
        key: "visit_history",
        oauth: [
          "ops.customers.read",
          "ops.jobs.read",
          "ops.schedule.read",
          "ops.site_visits.read",
        ],
        permissions: [
          [
            "calendar.view:all,own",
            "clients.view:all,assigned",
            "pipeline.view:all,assigned",
          ],
        ],
      },
      {
        key: "unlinked_history",
        oauth: ["ops.jobs.read", "ops.site_visits.read"],
        permissions: [["pipeline.view:all"]],
      },
    ]);
  });

  it("keeps linked and unlinked artifact authority nominal and exact", () => {
    expect(policyShape(GET_SITE_VISIT_CONTEXT_CANDIDATE)).toEqual([
      {
        key: "opportunity",
        oauth: [
          "ops.customers.read",
          "ops.jobs.read",
          "ops.schedule.read",
          "ops.site_visits.read",
        ],
        permissions: [
          [
            "calendar.view:all,own",
            "clients.view:all,assigned",
            "pipeline.view:all,assigned",
          ],
        ],
      },
      {
        key: "unlinked",
        oauth: ["ops.jobs.read", "ops.site_visits.read"],
        permissions: [["pipeline.view:all"]],
      },
      {
        key: "opportunity_artifacts",
        oauth: ["ops.files.read", "ops.site_visits.read"],
        permissions: [["photos.view:all,assigned"]],
      },
      {
        key: "unlinked_artifacts",
        oauth: ["ops.files.read", "ops.site_visits.read"],
        permissions: [["photos.view:all"]],
      },
      {
        key: "opportunity_decks",
        oauth: ["ops.files.read", "ops.jobs.read", "ops.site_visits.read"],
        permissions: [
          ["deck_builder.view:all,assigned", "photos.view:all,assigned"],
        ],
      },
      {
        key: "unlinked_decks",
        oauth: ["ops.files.read", "ops.jobs.read", "ops.site_visits.read"],
        permissions: [["deck_builder.view:all", "photos.view:all"]],
      },
    ]);
  });

  it("selects only the exact view, unlinked, and requested artifact variants", () => {
    expect(
      selectedListSiteVisitsVariantKeys({
        view: "booked_appointments",
        from: "2026-08-20T00:00:00.000Z",
        to: "2026-08-30T00:00:00.000Z",
        statuses: ["in_progress", "scheduled"],
        limit: 25,
      })
    ).toEqual(["booked_appointments"]);
    expect(
      selectedListSiteVisitsVariantKeys({
        view: "visit_history",
        created_from: "2026-08-20T00:00:00.000Z",
        created_to: "2026-08-30T00:00:00.000Z",
        include_unlinked: true,
        limit: 25,
      })
    ).toEqual(["visit_history", "unlinked_history"]);

    expect(
      selectedGetSiteVisitContextVariantKeys({
        anchor: "opportunity",
        opportunity_ref: {
          kind: "opportunity",
          id: "33333333-3333-4333-8333-333333333333",
        },
        site_visit_ref: {
          kind: "site_visit",
          id: "11111111-1111-4111-8111-111111111111",
        },
        sections: ["artifact_summary", "deck_design_refs"],
      })
    ).toEqual(["opportunity", "opportunity_artifacts", "opportunity_decks"]);
    expect(
      selectedGetSiteVisitContextVariantKeys({
        anchor: "unlinked",
        site_visit_ref: {
          kind: "site_visit",
          id: "11111111-1111-4111-8111-111111111111",
        },
        sections: ["deck_design_refs"],
      })
    ).toEqual(["unlinked", "unlinked_decks"]);
  });
});
