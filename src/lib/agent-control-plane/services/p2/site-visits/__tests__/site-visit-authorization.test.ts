import { describe, expect, it } from "vitest";

import {
  GetSiteVisitContextInputSchema,
  ListSiteVisitsInputSchema,
} from "@/lib/agent-control-plane/contracts/site-visits";
import {
  GET_SITE_VISIT_CONTEXT_CANDIDATE,
  LIST_SITE_VISITS_CANDIDATE,
  selectedGetSiteVisitContextVariantKeys,
  selectedListSiteVisitsVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/site-visits";
import {
  authorizeGetSiteVisitContextRead,
  authorizeListSiteVisitsRead,
  isAuthorizedGetSiteVisitContextRead,
  isAuthorizedListSiteVisitsRead,
  SiteVisitReadAuthorizationError,
} from "../site-visit-authorization";
import {
  SITE_VISIT_GRANT_ID,
  SITE_VISIT_ID,
  SITE_VISIT_OAUTH_CLIENT_ID,
  SITE_VISIT_OPPORTUNITY_ID,
  siteVisitCandidateAuthorizations,
} from "./site-visit-fixtures";

describe("P2 site-visit nominal authorization", () => {
  it("mints exact linked appointment authority with the calendar/client/pipeline intersection", async () => {
    const query = ListSiteVisitsInputSchema.parse({
      view: "booked_appointments",
      from: "2026-08-20T00:00:00.000Z",
      to: "2026-08-30T00:00:00.000Z",
    });
    const keys = selectedListSiteVisitsVariantKeys(query);
    const proof = authorizeListSiteVisitsRead({
      query,
      authorizations: await siteVisitCandidateAuthorizations({
        candidate: LIST_SITE_VISITS_CANDIDATE,
        keys,
        scopes: {
          "calendar.view": "own",
          "clients.view": "assigned",
          "pipeline.view": "assigned",
        },
      }),
    });

    expect(isAuthorizedListSiteVisitsRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      capabilityId: "list_site_visits",
      requiredOAuthScopes: [
        "ops.customers.read",
        "ops.jobs.read",
        "ops.schedule.read",
        "ops.site_visits.read",
      ],
      calendarScope: "own",
      clientsScope: "assigned",
      pipelineScope: "assigned",
      photosScope: null,
      oauthGrantId: SITE_VISIT_GRANT_ID,
      oauthClientId: SITE_VISIT_OAUTH_CLIENT_ID,
      variantKeys: ["booked_appointments"],
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.query)).toBe(true);
  });

  it("requires and records all-pipeline authority when history includes genuinely unlinked visits", async () => {
    const query = ListSiteVisitsInputSchema.parse({
      view: "visit_history",
      created_from: "2026-08-20T00:00:00.000Z",
      created_to: "2026-08-30T00:00:00.000Z",
      include_unlinked: true,
    });
    const keys = selectedListSiteVisitsVariantKeys(query);
    const proof = authorizeListSiteVisitsRead({
      query,
      authorizations: await siteVisitCandidateAuthorizations({
        candidate: LIST_SITE_VISITS_CANDIDATE,
        keys,
      }),
    });

    expect(proof.pipelineScope).toBe("all");
    expect(proof.variantKeys).toEqual(["visit_history", "unlinked_history"]);
  });

  it("keeps linked artifact authority separate and cannot borrow the base policy", async () => {
    const query = GetSiteVisitContextInputSchema.parse({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["artifact_summary", "deck_design_refs"],
    });
    const keys = selectedGetSiteVisitContextVariantKeys(query);
    const exact = await siteVisitCandidateAuthorizations({
      candidate: GET_SITE_VISIT_CONTEXT_CANDIDATE,
      keys,
      scopes: {
        "calendar.view": "own",
        "clients.view": "assigned",
        "deck_builder.view": "assigned",
        "photos.view": "assigned",
        "pipeline.view": "assigned",
      },
    });
    const proof = authorizeGetSiteVisitContextRead({
      query,
      authorizations: exact,
    });

    expect(isAuthorizedGetSiteVisitContextRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      requiredOAuthScopes: [
        "ops.customers.read",
        "ops.files.read",
        "ops.jobs.read",
        "ops.schedule.read",
        "ops.site_visits.read",
      ],
      calendarScope: "own",
      clientsScope: "assigned",
      deckBuilderScope: "assigned",
      photosScope: "assigned",
      pipelineScope: "assigned",
      variantKeys: [
        "opportunity",
        "opportunity_artifacts",
        "opportunity_decks",
      ],
    });

    expect(() =>
      authorizeGetSiteVisitContextRead({
        query,
        authorizations: {
          opportunity: exact.opportunity,
          opportunity_artifacts: exact.opportunity,
          opportunity_decks: exact.opportunity,
        },
      })
    ).toThrow(SiteVisitReadAuthorizationError);
  });

  it("requires photos=all and pipeline=all for unlinked artifact context", async () => {
    const query = GetSiteVisitContextInputSchema.parse({
      anchor: "unlinked",
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["artifact_summary", "notes"],
    });
    const keys = selectedGetSiteVisitContextVariantKeys(query);
    const exact = await siteVisitCandidateAuthorizations({
      candidate: GET_SITE_VISIT_CONTEXT_CANDIDATE,
      keys,
    });
    const proof = authorizeGetSiteVisitContextRead({
      query,
      authorizations: exact,
    });
    expect(proof).toMatchObject({
      calendarScope: null,
      clientsScope: null,
      pipelineScope: "all",
      photosScope: "all",
      deckBuilderScope: null,
      variantKeys: ["unlinked", "unlinked_artifacts"],
    });
  });

  it("requires an explicit deck policy before repository authority can be minted", async () => {
    const query = GetSiteVisitContextInputSchema.parse({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["deck_design_refs"],
    });
    const keys = selectedGetSiteVisitContextVariantKeys(query);
    expect(keys).toEqual(["opportunity", "opportunity_decks"]);

    const exact = await siteVisitCandidateAuthorizations({
      candidate: GET_SITE_VISIT_CONTEXT_CANDIDATE,
      keys,
      scopes: {
        "calendar.view": "own",
        "clients.view": "assigned",
        "deck_builder.view": "assigned",
        "photos.view": "assigned",
        "pipeline.view": "assigned",
      },
    });
    const proof = authorizeGetSiteVisitContextRead({
      query,
      authorizations: exact,
    });
    expect(proof).toMatchObject({
      deckBuilderScope: "assigned",
      photosScope: "assigned",
      requiredOAuthScopes: [
        "ops.customers.read",
        "ops.files.read",
        "ops.jobs.read",
        "ops.schedule.read",
        "ops.site_visits.read",
      ],
      variantKeys: ["opportunity", "opportunity_decks"],
    });

    expect(() =>
      authorizeGetSiteVisitContextRead({
        query,
        authorizations: { opportunity: exact.opportunity },
      })
    ).toThrow(SiteVisitReadAuthorizationError);
  });

  it("rejects missing, extra, cloned, and cross-policy authorization records", async () => {
    const query = GetSiteVisitContextInputSchema.parse({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
    });
    const keys = selectedGetSiteVisitContextVariantKeys(query);
    const exact = await siteVisitCandidateAuthorizations({
      candidate: GET_SITE_VISIT_CONTEXT_CANDIDATE,
      keys,
    });
    for (const invalid of [
      {},
      { ...exact, extra: exact.opportunity },
      { opportunity: { ...exact.opportunity } },
    ]) {
      expect(() =>
        authorizeGetSiteVisitContextRead({ query, authorizations: invalid })
      ).toThrow(SiteVisitReadAuthorizationError);
    }
  });
});
