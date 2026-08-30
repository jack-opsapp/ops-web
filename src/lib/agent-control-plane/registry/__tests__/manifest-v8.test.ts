import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { isActiveManifestCapabilityPolicy } from "@/lib/agent-control-plane/actor/capability-policy-boundary";

import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
  V7_CAPABILITY_MANIFEST,
  V7_CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  MCP_EXPOSURE_V1,
  MCP_EXPOSURE_V2,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
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

function serializedManifestProjection<
  T extends { readonly inputSchema: unknown },
>(manifest: readonly T[]): string {
  return JSON.stringify(
    manifest.map(({ inputSchema: _inputSchema, ...entry }) => entry)
  );
}

function serializedP2AuthorizationProjection(
  candidate: (typeof P2_READ_CAPABILITY_CANDIDATES)[number]
): string {
  return JSON.stringify({
    name: candidate.name,
    authorization: candidate.authorization,
  });
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

  it("pins the complete v8 manifest and every P2 authorization projection byte-for-byte", () => {
    const serializedManifest =
      serializedManifestProjection(CAPABILITY_MANIFEST);
    const manifestDigest = createHash("sha256")
      .update(serializedManifest)
      .digest("hex");
    const authorizationDigests = P2_READ_CAPABILITY_CANDIDATES.map(
      (candidate) => {
        const serialized = serializedP2AuthorizationProjection(candidate);
        return {
          name: candidate.name,
          byteLength: new TextEncoder().encode(serialized).byteLength,
          sha256: createHash("sha256").update(serialized).digest("hex"),
        };
      }
    );

    expect({
      byteLength: new TextEncoder().encode(serializedManifest).byteLength,
      sha256: manifestDigest,
    }).toEqual({
      byteLength: 121_464,
      sha256:
        "f9d0228eb5dd1c577a78860c5f14131ab86387eab9c48adfd52daa59130e9289",
    });
    expect(authorizationDigests).toEqual([
      {
        name: "get_customer_context",
        byteLength: 1_879,
        sha256:
          "166de5d84f972b58c19007a45a7fda5d3cd0f0f17d64253830a77e4647b94807",
      },
      {
        name: "list_tasks",
        byteLength: 1_021,
        sha256:
          "9d38ff44c52bf179e53b896fe6cbb19d713d3011959a98b0ee0f9d0909197863",
      },
      {
        name: "get_task_context",
        byteLength: 1_667,
        sha256:
          "664b817b8946089ae2cfa463e529544a2c72e287d3dd3e2ce6b917bcdbd357aa",
      },
      {
        name: "list_job_artifacts",
        byteLength: 5_190,
        sha256:
          "17a53755d2f626801ee14ec8e5842b5dde938efa9cad44403e0b55470d515d3d",
      },
      {
        name: "get_job_artifact_evidence",
        byteLength: 5_351,
        sha256:
          "09c1e7953d4f6dc4ee888ab81711ca87f5c14882841996762254a7386c8d60ed",
      },
      {
        name: "list_site_visits",
        byteLength: 1_669,
        sha256:
          "5a36fae49d01f0e5286c9efa6f75f878e336ece7e1bbcfc399e3add80f28d31f",
      },
      {
        name: "get_site_visit_context",
        byteLength: 3_205,
        sha256:
          "41919f4d1166c3bcc259d21adbe299da8565c53e0a058fe53279503a7f212ff1",
      },
      {
        name: "get_deck_design_geometry",
        byteLength: 3_688,
        sha256:
          "cae82cdb55e204c71033125886a486fe4378086fd802ba1cf6761f0452deda86",
      },
      {
        name: "list_sales_documents",
        byteLength: 1_575,
        sha256:
          "5c50f81403bc23d2b06bd26f05f367fbf848c658a20b816efa148ed77a6e9a4e",
      },
      {
        name: "get_sales_document",
        byteLength: 1_619,
        sha256:
          "ffb316d0f0d55c82f74c320d2754b39fda7958d7db876f4e838c18659707fed2",
      },
      {
        name: "list_payments",
        byteLength: 832,
        sha256:
          "0be43f2e3268c7a445181164285bd4d795a4f432137d14117ee7634af68a8e29",
      },
      {
        name: "list_expenses",
        byteLength: 2_503,
        sha256:
          "ff5f5cf95090aab67f146c17b83ebe068fca6efb832ca1cd7925f232bd5ec26d",
      },
      {
        name: "get_expense_context",
        byteLength: 677,
        sha256:
          "ff706ed1965627425c9143d4168141f4e85dd495484c5598a76141ce12d0d513",
      },
      {
        name: "list_work_queue",
        byteLength: 5_360,
        sha256:
          "c9b94368a1cbbc7fb223a57614ace93aa69aeb0189e973777c86468fcf6e716a",
      },
      {
        name: "search_catalog_items",
        byteLength: 475,
        sha256:
          "4e85c75bd028ab46532bd5c7c81c1a7725f6bec9566c7770f45fb40c50f4dd1f",
      },
      {
        name: "get_catalog_item",
        byteLength: 940,
        sha256:
          "e18da8b70e7b7897cd9535d4830af60bb0ae549fb917cc3b0649a033bdb641f3",
      },
      {
        name: "list_purchase_orders",
        byteLength: 888,
        sha256:
          "3b3fbcf0c79e17e31fdbb8c412a4a8ff2b3a83271050557f90486ed6ede12ba7",
      },
      {
        name: "get_purchase_order",
        byteLength: 878,
        sha256:
          "95c68e5d32c098516e382dad05d985918de9aaf54da0f5d977eb99f26a8ad7b9",
      },
      {
        name: "get_company_context",
        byteLength: 413,
        sha256:
          "d8a042532f61c25d93aca9bc60139939269b00be5849438567c6335b085641b1",
      },
      {
        name: "list_team_members",
        byteLength: 394,
        sha256:
          "0b69e4db86e5893fa15183a39609e1cf8bf678d00a2ff3f9d6fc0851eec86ef9",
      },
      {
        name: "list_team_availability",
        byteLength: 895,
        sha256:
          "e68eede08a33896e925b8fd64f0c9140685947cef3607f1ec67da8fa42941c0a",
      },
      {
        name: "get_integration_health",
        byteLength: 1_125,
        sha256:
          "0990e923b187938adf49d08c81393c04da5ed4fd57fe18f5eeac9238d9ad66d6",
      },
      {
        name: "get_operational_overview",
        byteLength: 4_570,
        sha256:
          "327c81912e8b8246617fa5683595b6442d686ca8806cb5ba50f804e6939cd5ee",
      },
    ]);
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

  it("keeps v1 frozen while v2 exposes every implemented read and only read scopes", () => {
    expect(MCP_EXPOSURE_V1.toolIds).toHaveLength(11);
    expect(MCP_EXPOSURE_V1.grantableScopes).toHaveLength(7);
    expect(MCP_EXPOSURE_V1.toolIds).toEqual(EXPECTED_V8_READS.slice(0, 11));
    for (const toolId of MCP_EXPOSURE_V1.toolIds) {
      expect(EXPECTED_V8_READS).toContain(toolId);
    }
    for (const p2Read of EXPECTED_V8_READS.slice(11)) {
      expect(MCP_EXPOSURE_V1.toolIds).not.toContain(p2Read);
    }

    expect(MCP_EXPOSURE_V2.toolIds).toEqual(EXPECTED_V8_READS);
    expect(MCP_EXPOSURE_V2.toolIds).toHaveLength(34);
    expect(MCP_EXPOSURE_V2.grantableScopes).toHaveLength(20);
    for (const scope of MCP_EXPOSURE_V2.grantableScopes) {
      expect(scope).toMatch(/^ops\.[a-z_]+\.read$/);
    }
  });
});
