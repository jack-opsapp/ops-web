import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { isActiveManifestCapabilityPolicy } from "@/lib/agent-control-plane/actor/capability-policy-boundary";

import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
  V7_CAPABILITY_MANIFEST,
  V7_CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V1 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  P2_READ_CAPABILITY_CANDIDATES,
  P2_READ_CAPABILITY_IDS,
  RESERVED_P2_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2";

const EXPECTED_V8_READS = [
  "list_scheduled_jobs",
  "list_job_readiness_issues",
  "get_job_communication_context",
  "get_job_conversation_context",
  "list_customer_jobs",
  "get_job_summary",
  "search_job_history",
  "get_correspondence_evidence",
  "search_customers",
  "search_jobs",
  "resolve_job_participants",
  "get_customer_context",
  "list_tasks",
  "get_task_context",
  "list_job_artifacts",
  "get_job_artifact_evidence",
  "list_site_visits",
  "get_site_visit_context",
  "get_deck_design_geometry",
  "list_sales_documents",
  "get_sales_document",
  "list_payments",
  "list_expenses",
  "get_expense_context",
  "list_work_queue",
  "search_catalog_items",
  "get_catalog_item",
  "list_purchase_orders",
  "get_purchase_order",
  "get_company_context",
  "list_team_members",
  "list_team_availability",
  "get_integration_health",
  "get_operational_overview",
] as const;

const EXPECTED_DARK_WRITES = [
  "prepare_project_cost_allocation",
  "commit_project_cost_allocation",
  "prepare_estimate_import",
  "commit_estimate_import",
  "prepare_catalog_service_change",
  "commit_catalog_service_change",
  "prepare_client_message_batch",
  "commit_client_message_batch",
  "prepare_site_visit_booking",
  "commit_site_visit_booking",
  "prepare_site_visit_reschedule",
  "commit_site_visit_reschedule",
  "prepare_site_visit_booking_cancellation",
  "commit_site_visit_booking_cancellation",
] as const;

function serializedManifestProjection(
  manifest: typeof V7_CAPABILITY_MANIFEST
): string {
  return JSON.stringify(
    manifest.map(({ inputSchema: _inputSchema, ...entry }) => entry)
  );
}

describe("immutable v8 capability manifest", () => {
  it("mints exactly thirty-four implemented reads while every write stays dark", () => {
    expect(CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-22.capability-manifest.v8"
    );
    expect(CAPABILITY_MANIFEST_REVISION).toBe(RESERVED_P2_MANIFEST_REVISION);
    expect(
      CAPABILITY_MANIFEST.filter((entry) => entry.operation === "read").map(
        (entry) => entry.name
      )
    ).toEqual(EXPECTED_V8_READS);
    expect(
      CAPABILITY_MANIFEST.filter((entry) => entry.operation !== "read").map(
        (entry) => entry.name
      )
    ).toEqual(EXPECTED_DARK_WRITES);
    expect(CAPABILITY_MANIFEST).toHaveLength(48);

    for (const entry of CAPABILITY_MANIFEST) {
      expect(entry.availability).toEqual({
        implementation:
          entry.operation === "read" ? "available" : "unavailable",
      });
      expect(Object.keys(entry.availability)).toEqual(["implementation"]);
      for (const variant of entry.authorization.variants) {
        expect(isActiveManifestCapabilityPolicy(variant.policy)).toBe(true);
      }
    }
  });

  it("reuses every final P2 candidate and its nominal policy bytes exactly", () => {
    expect(P2_READ_CAPABILITY_CANDIDATES).toHaveLength(23);
    expect(
      P2_READ_CAPABILITY_CANDIDATES.map((candidate) => candidate.name)
    ).toEqual(EXPECTED_V8_READS.slice(11));
    expect(P2_READ_CAPABILITY_IDS).toEqual(EXPECTED_V8_READS.slice(11));

    const activeP2 = CAPABILITY_MANIFEST.slice(11, 34);
    for (const [index, candidate] of P2_READ_CAPABILITY_CANDIDATES.entries()) {
      const active = activeP2[index];
      expect(active).toBe(candidate);
      expect(active?.authorization).toBe(candidate.authorization);
      expect(active?.authorization.variants).toBe(
        candidate.authorization.variants
      );
      for (const [
        variantIndex,
        variant,
      ] of candidate.authorization.variants.entries()) {
        expect(active?.authorization.variants[variantIndex]?.policy).toBe(
          variant.policy
        );
      }
    }
  });

  it("preserves the complete v7 manifest projection byte-for-byte", () => {
    const serialized = serializedManifestProjection(V7_CAPABILITY_MANIFEST);

    expect(V7_CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-20.capability-manifest.v7"
    );
    expect(new TextEncoder().encode(serialized)).toHaveLength(61_456);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "ac134896bda42ba008783b107f1f7f7a9d1a0da60af0770ca5cd0b2c8a8b5779"
    );
  });

  it("keeps the external exposure frozen at eleven reads and seven scopes", () => {
    expect(MCP_EXPOSURE_V1.toolIds).toHaveLength(11);
    expect(MCP_EXPOSURE_V1.grantableScopes).toHaveLength(7);
    expect(MCP_EXPOSURE_V1.toolIds).toEqual(EXPECTED_V8_READS.slice(0, 11));
    for (const toolId of MCP_EXPOSURE_V1.toolIds) {
      expect(EXPECTED_V8_READS).toContain(toolId);
    }
    for (const p2Read of EXPECTED_V8_READS.slice(11)) {
      expect(MCP_EXPOSURE_V1.toolIds).not.toContain(p2Read);
    }
  });
});
