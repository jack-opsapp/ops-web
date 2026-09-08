import { describe, expect, it } from "vitest";
import * as contracts from "../financial-policy";
import {
  MCP_EXPOSURE_CATALOG,
  MCP_EXPOSURE_V17,
  resolveActiveMcpExposure,
} from "../../registry/mcp-exposure-catalog";
import * as consent from "../../mcp/oauth/scope-catalog";

describe("financial readiness contract", () => {
  it("requires exact explicit source and prior policy binding", () => {
    expect(contracts.FinancialPolicyInputSchema).toBeDefined();
    const input = {
      revision: "owner-1",
      source_document_id: "40000000-0000-4000-8000-000000000001",
      source_sha256: `sha256:${"a".repeat(64)}`,
      expected_policy_sha256: null,
      currency_code: "CAD",
      terms: "Payment on completion",
      permitted_units: ["hour"],
      permitted_price_sources: ["historical_line"],
    };
    expect(contracts.FinancialPolicyInputSchema.safeParse(input).success).toBe(
      true
    );
    for (const bad of [
      { ...input, source_sha256: null },
      { ...input, expected_policy_sha256: undefined },
      { ...input, permitted_units: ["hour", "hour"] },
      { ...input, standing_save_approval: true },
      { ...input, permitted_price_sources: ["invoice"] },
      { ...input, revision: "  owner-1" },
    ])
      expect(contracts.FinancialPolicyInputSchema.safeParse(bad).success).toBe(
        false
      );
  });
  it("defines preparation consent without selecting or activating financial exposure", () => {
    expect(consent.MCP_CONSENT_CATALOG_V12).toBeDefined();
    expect(
      consent.MCP_CONSENT_CATALOG_V12.consentLabels[
        "ops.financial_documents.prepare"
      ]
    ).toContain("exact approval in OPS");
    expect(
      consent.MCP_CONSENT_CATALOG[consent.MCP_CONSENT_CATALOG_V12.revision]
    ).toBeUndefined();
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V17.revision]).toBeUndefined();
    const snapshot = consent.consentSnapshotForExposure(
      MCP_EXPOSURE_V17,
      consent.MCP_CONSENT_CATALOG_V12
    );
    expect(snapshot.scopeCeiling).toEqual(MCP_EXPOSURE_V17.grantableScopes);
    expect(snapshot.acceptedLabels).toHaveLength(snapshot.scopeCeiling.length);
    expect(() =>
      consent.consentSnapshotForExposure(
        MCP_EXPOSURE_V17,
        consent.MCP_CONSENT_CATALOG_V9
      )
    ).toThrow("mismatch");
    expect(resolveActiveMcpExposure().revision).toBe(
      "2026-09-04.mcp-exposure.v14"
    );
  });
});
