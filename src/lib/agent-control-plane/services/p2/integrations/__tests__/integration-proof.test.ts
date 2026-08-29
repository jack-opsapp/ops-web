import { describe, expect, it } from "vitest";

import {
  INTEGRATION_READ_AT,
  INTEGRATION_SOURCE_INSPECTED,
  INTEGRATION_SOURCE_REVISIONS,
  integrationAuthorization,
  integrationItems,
} from "./integration-fixtures";
import {
  integrationHealthCollectionProofRef,
  integrationHealthEntityProofRef,
  integrationHealthEvidenceRef,
  integrationHealthProofContext,
} from "../integration-proof";

describe("P2 integration-health proof", () => {
  it("binds selected authority, safe state, source counts, revisions, and time", async () => {
    const authorization = await integrationAuthorization();
    const context = integrationHealthProofContext({
      authorization,
      readAt: INTEGRATION_READ_AT,
      sourceRevisions: INTEGRATION_SOURCE_REVISIONS,
      sourceInspected: INTEGRATION_SOURCE_INSPECTED,
    });
    const item = integrationItems()[0]!;
    const selection = authorization.query.integrations[0]!;
    const proof = integrationHealthEntityProofRef({ context, item });
    const evidence = integrationHealthEvidenceRef({ context, selection });
    const collection = integrationHealthCollectionProofRef({
      context,
      children: [{ selection, proof_ref: proof, evidence_ref: evidence }],
    });

    expect(proof).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(evidence).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(collection).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(
      integrationHealthEntityProofRef({
        context: {
          ...context,
          source_inspected: { ...context.source_inspected, mailbox: 2 },
        },
        item,
      })
    ).not.toBe(proof);
    expect(
      integrationHealthEntityProofRef({
        context,
        item: { ...item, sync_state: "disabled", reason_code: "sync_disabled" },
      })
    ).not.toBe(proof);
  });
});
