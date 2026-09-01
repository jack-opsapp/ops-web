import { describe, expect, it } from "vitest";

import {
  operationalOverviewCollectionProofRef,
  operationalOverviewEntityProofRef,
  operationalOverviewEvidenceRef,
  operationalOverviewProofContext,
} from "../overview-proof";
import { overviewAuthorization } from "./overview-fixtures";

describe("operational overview proofs", () => {
  it("binds each item to only its own nonempty revision subset", async () => {
    const authorization = await overviewAuthorization({
      query: {
        components: ["integration_attention", "schedule_readiness"],
      },
    });
    const context = operationalOverviewProofContext({
      authorization,
      readAt: "2026-08-29T23:30:00.000Z",
      componentSourceInspected: [
        { component: "integration_attention", source_inspected: 2 },
        { component: "schedule_readiness", source_inspected: 1 },
      ],
    });
    const item = {
      component: "integration_attention" as const,
      state: "attention" as const,
      attention_count: 1,
      count_state: "exact" as const,
    };
    const revisions = [{ domain: "integrations", source_revision: 7 }] as const;
    const proof = operationalOverviewEntityProofRef({
      context,
      item,
      sourceInspected: 2,
      sourceRevisions: revisions,
    });
    expect(proof).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(
      operationalOverviewEntityProofRef({
        context,
        item,
        sourceInspected: 2,
        sourceRevisions: [{ domain: "schedule", source_revision: 11 }],
      })
    ).not.toBe(proof);
    expect(() =>
      operationalOverviewEntityProofRef({
        context,
        item,
        sourceInspected: 2,
        sourceRevisions: [],
      })
    ).toThrowError("OPERATIONAL_OVERVIEW_ITEM_REVISION_VECTOR_EMPTY");
  });

  it("binds evidence to the exact component authorization and revisions", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    const context = operationalOverviewProofContext({
      authorization,
      readAt: "2026-08-29T23:30:00.000Z",
      componentSourceInspected: [
        { component: "integration_attention", source_inspected: 2 },
      ],
    });
    const evidence = operationalOverviewEvidenceRef({
      context,
      component: "integration_attention",
      sourceInspected: 2,
      sourceRevisions: [{ domain: "integrations", source_revision: 7 }],
    });
    expect(evidence).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(
      operationalOverviewEvidenceRef({
        context,
        component: "integration_attention",
        sourceInspected: 2,
        sourceRevisions: [{ domain: "integrations", source_revision: 8 }],
      })
    ).not.toBe(evidence);
    expect(() =>
      operationalOverviewEvidenceRef({
        context,
        component: "work_due",
        sourceInspected: 1,
        sourceRevisions: [{ domain: "tasks", source_revision: 1 }],
      })
    ).toThrowError("OPERATIONAL_OVERVIEW_COMPONENT_NOT_AUTHORIZED");
  });

  it("binds collection proof to the canonical aggregate union and children", async () => {
    const authorization = await overviewAuthorization({
      query: {
        components: ["integration_attention", "schedule_readiness"],
      },
    });
    const context = operationalOverviewProofContext({
      authorization,
      readAt: "2026-08-29T23:30:00.000Z",
      componentSourceInspected: [
        { component: "integration_attention", source_inspected: 2 },
        { component: "schedule_readiness", source_inspected: 1 },
      ],
    });
    const children = [
      {
        component: "integration_attention" as const,
        proof_ref: `ops_proof:v1:${"1".repeat(64)}`,
        evidence_ref: `ops_evidence:v1:${"2".repeat(64)}`,
        source_inspected: 2,
        source_revisions: [{ domain: "integrations", source_revision: 7 }],
      },
      {
        component: "schedule_readiness" as const,
        proof_ref: `ops_proof:v1:${"3".repeat(64)}`,
        evidence_ref: `ops_evidence:v1:${"4".repeat(64)}`,
        source_inspected: 1,
        source_revisions: [{ domain: "schedule", source_revision: 11 }],
      },
    ] as const;
    const revisions = [
      { domain: "integrations", source_revision: 7 },
      { domain: "schedule", source_revision: 11 },
    ] as const;
    const proof = operationalOverviewCollectionProofRef({
      context,
      sourceRevisions: revisions,
      children,
    });
    expect(proof).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(() =>
      operationalOverviewCollectionProofRef({
        context,
        sourceRevisions: revisions,
        children: [...children].reverse(),
      })
    ).toThrowError("OPERATIONAL_OVERVIEW_COLLECTION_CHILDREN_INVALID");
  });

  it("mints a warnings-only request-bound proof without source material", async () => {
    const authorization = await overviewAuthorization({
      scopes: ["ops.operations.read"],
      permissions: [["reports.view", "all"]],
    });
    const context = operationalOverviewProofContext({
      authorization,
      readAt: "2026-08-29T23:30:00.000Z",
      componentSourceInspected: [],
    });
    const proof = operationalOverviewCollectionProofRef({
      context,
      sourceRevisions: [],
      children: [],
    });
    expect(proof).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(context.authorized_components).toEqual([]);
    expect(context.warnings).toHaveLength(6);
    expect(context.source_inspected).toBe(0);
    expect(context.component_source_inspected).toEqual([]);
    expect(context.request_id).toBe("request-operational-overview");

    const changedRequestAuthorization = {
      ...authorization,
      actorContext: {
        ...authorization.actorContext,
        requestId: "request-operational-overview-retry",
      },
    } as typeof authorization;
    expect(() =>
      operationalOverviewProofContext({
        authorization: changedRequestAuthorization,
        readAt: "2026-08-29T23:30:00.000Z",
        componentSourceInspected: [],
      })
    ).toThrowError("OPERATIONAL_OVERVIEW_AUTHORIZATION_INVALID");
  });

  it("rejects fabricated source inspection for a warnings-only result", async () => {
    const authorization = await overviewAuthorization({
      scopes: ["ops.operations.read"],
      permissions: [["reports.view", "all"]],
    });
    expect(() =>
      operationalOverviewProofContext({
        authorization,
        readAt: "2026-08-29T23:30:00.000Z",
        componentSourceInspected: [
          { component: "work_due", source_inspected: 1 },
        ],
      })
    ).toThrowError("OPERATIONAL_OVERVIEW_SOURCE_INSPECTION_INVALID");
  });

  it("binds only the child authorization and exact child inspection count", async () => {
    const authorization = await overviewAuthorization({
      query: {
        components: ["integration_attention", "schedule_readiness"],
      },
    });
    const context = operationalOverviewProofContext({
      authorization,
      readAt: "2026-08-29T23:30:00.000Z",
      componentSourceInspected: [
        { component: "integration_attention", source_inspected: 2 },
        { component: "schedule_readiness", source_inspected: 1 },
      ],
    });
    const item = {
      component: "integration_attention" as const,
      state: "attention" as const,
      attention_count: 1,
      count_state: "exact" as const,
    };
    const revisions = [{ domain: "integrations", source_revision: 7 }] as const;
    const proof = operationalOverviewEntityProofRef({
      context,
      item,
      sourceInspected: 2,
      sourceRevisions: revisions,
    });
    const otherAuthorizationChanged = {
      ...context,
      authorized_components: context.authorized_components.map(
        (component, index) =>
          index === 1
            ? {
                ...component,
                resolved_permission_scopes: { "tasks.view": "assigned" },
              }
            : component
      ),
    };
    expect(
      operationalOverviewEntityProofRef({
        context: otherAuthorizationChanged,
        item,
        sourceInspected: 2,
        sourceRevisions: revisions,
      })
    ).toBe(proof);

    const childAuthorizationChanged = {
      ...context,
      authorized_components: context.authorized_components.map(
        (component, index) =>
          index === 0
            ? {
                ...component,
                resolved_permission_scopes:
                  context.authorized_components[1]!.resolved_permission_scopes,
              }
            : component
      ),
    };
    expect(
      operationalOverviewEntityProofRef({
        context: childAuthorizationChanged,
        item,
        sourceInspected: 2,
        sourceRevisions: revisions,
      })
    ).not.toBe(proof);
    expect(() =>
      operationalOverviewEntityProofRef({
        context,
        item,
        sourceInspected: 1,
        sourceRevisions: revisions,
      })
    ).toThrowError("OPERATIONAL_OVERVIEW_SOURCE_INSPECTION_INVALID");
  });

  it("binds the collection to ordered component inspections, not only their total", async () => {
    const authorization = await overviewAuthorization({
      query: {
        components: ["integration_attention", "schedule_readiness"],
      },
    });
    const base = operationalOverviewProofContext({
      authorization,
      readAt: "2026-08-29T23:30:00.000Z",
      componentSourceInspected: [
        { component: "integration_attention", source_inspected: 2 },
        { component: "schedule_readiness", source_inspected: 1 },
      ],
    });
    const redistributed = operationalOverviewProofContext({
      authorization,
      readAt: "2026-08-29T23:30:00.000Z",
      componentSourceInspected: [
        { component: "integration_attention", source_inspected: 1 },
        { component: "schedule_readiness", source_inspected: 2 },
      ],
    });
    const children = [
      {
        component: "integration_attention" as const,
        proof_ref: `ops_proof:v1:${"1".repeat(64)}`,
        evidence_ref: `ops_evidence:v1:${"2".repeat(64)}`,
        source_inspected: 2,
        source_revisions: [{ domain: "integrations", source_revision: 7 }],
      },
      {
        component: "schedule_readiness" as const,
        proof_ref: `ops_proof:v1:${"3".repeat(64)}`,
        evidence_ref: `ops_evidence:v1:${"4".repeat(64)}`,
        source_inspected: 1,
        source_revisions: [{ domain: "schedule", source_revision: 11 }],
      },
    ] as const;
    const revisions = [
      { domain: "integrations", source_revision: 7 },
      { domain: "schedule", source_revision: 11 },
    ] as const;
    const proof = operationalOverviewCollectionProofRef({
      context: base,
      sourceRevisions: revisions,
      children,
    });
    expect(() =>
      operationalOverviewCollectionProofRef({
        context: redistributed,
        sourceRevisions: revisions,
        children,
      })
    ).toThrowError("OPERATIONAL_OVERVIEW_COLLECTION_CHILDREN_INVALID");
    expect(base.source_inspected).toBe(redistributed.source_inspected);
    expect(proof).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
  });

  it("rejects component inspection values above exact physical caps", async () => {
    const authorization = await overviewAuthorization({
      query: { components: ["integration_attention"] },
    });
    expect(() =>
      operationalOverviewProofContext({
        authorization,
        readAt: "2026-08-29T23:30:00.000Z",
        componentSourceInspected: [
          { component: "integration_attention", source_inspected: 1001 },
        ],
      })
    ).toThrowError("OPERATIONAL_OVERVIEW_SOURCE_INSPECTION_INVALID");
  });
});
