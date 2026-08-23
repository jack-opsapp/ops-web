import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, it } from "vitest";

import { DOMAIN_METHOD_BY_CAPABILITY } from "@/lib/agent-control-plane/mcp/domain-dispatch";
import {
  SCOPE_CONSENT_LABELS,
  SUPPORTED_READ_SCOPES,
} from "@/lib/agent-control-plane/mcp/oauth/scopes";
import {
  CAPABILITY_MANIFEST,
  getCapabilityManifestEntry,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_CATALOG,
  MCP_EXPOSURE_V1,
  assertMcpExposureInvariants,
  resolveActiveMcpExposure,
  resolveMcpExposureRevision,
  type McpExposure,
  type McpExposureInvariantInput,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  MCP_SCOPE_CONSENT_LABELS,
  MCP_SCOPE_OPERATION_BY_ID,
  REGISTERED_MCP_SCOPES,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

const EXPECTED_EXPOSURE = {
  revision: "2026-08-22.mcp-exposure.v1",
  toolIds: [
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
  ],
  grantableScopes: [
    "ops.jobs.read",
    "ops.schedule.read",
    "ops.customers.read",
    "ops.customer_contacts.read",
    "ops.photos.read",
    "ops.correspondence.read",
    "ops.financials.read",
  ],
} as const;

type MutableInvariantInput = {
  exposure: {
    revision: string;
    toolIds: string[];
    grantableScopes: string[];
  };
  manifestEntries: McpExposureInvariantInput["manifestEntries"];
  domainMethods: Record<string, string>;
  registeredScopes: string[];
  scopeOperations: Record<string, string>;
  consentLabels: Record<string, string>;
};

function invariantInput(): MutableInvariantInput {
  return {
    exposure: {
      revision: MCP_EXPOSURE_V1.revision,
      toolIds: [...MCP_EXPOSURE_V1.toolIds],
      grantableScopes: [...MCP_EXPOSURE_V1.grantableScopes],
    },
    manifestEntries: CAPABILITY_MANIFEST,
    domainMethods: {
      ...DOMAIN_METHOD_BY_CAPABILITY,
    } as Record<string, string>,
    registeredScopes: [...REGISTERED_MCP_SCOPES],
    scopeOperations: { ...MCP_SCOPE_OPERATION_BY_ID },
    consentLabels: { ...MCP_SCOPE_CONSENT_LABELS } as Record<string, string>,
  };
}

describe("immutable MCP exposure catalogue", () => {
  it("pins the exact v1 bytes, order, and digest independently", () => {
    expect(MCP_EXPOSURE_V1).toEqual(EXPECTED_EXPOSURE);
    const serialized = JSON.stringify(MCP_EXPOSURE_V1);
    expect(new TextEncoder().encode(serialized)).toHaveLength(488);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "d45d11434ed1ecced446b9a92ed47c0416451420f5a03c115fec869297a6aa2f"
    );
  });

  it("deep-freezes and referentially reuses one active exposure object", () => {
    const first = resolveActiveMcpExposure();
    const second = resolveActiveMcpExposure();

    expectTypeOf(resolveActiveMcpExposure).toEqualTypeOf<() => McpExposure>();
    expect(first).toBe(MCP_EXPOSURE_V1);
    expect(second).toBe(first);
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V1.revision]).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.toolIds)).toBe(true);
    expect(Object.isFrozen(first.grantableScopes)).toBe(true);
  });

  it("makes OAuth compatibility views use the active object's exact scope array and neutral labels", () => {
    expect(SUPPORTED_READ_SCOPES).toBe(MCP_EXPOSURE_V1.grantableScopes);
    expect(SCOPE_CONSENT_LABELS).toBe(MCP_SCOPE_CONSENT_LABELS);
  });

  it("resolves every tool to one implemented read, label, required scope, and static method", () => {
    expect(() => assertMcpExposureInvariants(invariantInput())).not.toThrow();
    for (const toolId of MCP_EXPOSURE_V1.toolIds) {
      const entry = getCapabilityManifestEntry(toolId);
      expect(entry.operation).toBe("read");
      expect(entry.availability.implementation).toBe("available");
      expect(DOMAIN_METHOD_BY_CAPABILITY).toHaveProperty(toolId);
    }
    for (const scope of MCP_EXPOSURE_V1.grantableScopes) {
      expect(MCP_SCOPE_CONSENT_LABELS).toHaveProperty(scope);
    }
  });

  it.each([
    {
      name: "a duplicate tool ID",
      mutate(input: MutableInvariantInput) {
        input.exposure.toolIds = [
          ...input.exposure.toolIds,
          input.exposure.toolIds[0]!,
        ];
      },
    },
    {
      name: "a duplicate grantable scope",
      mutate(input: MutableInvariantInput) {
        input.exposure.grantableScopes = [
          ...input.exposure.grantableScopes,
          input.exposure.grantableScopes[0]!,
        ];
      },
    },
    {
      name: "a write capability",
      mutate(input: MutableInvariantInput) {
        input.exposure.toolIds = [
          "prepare_estimate_import",
          ...input.exposure.toolIds.slice(1),
        ];
      },
    },
    {
      name: "an unavailable read",
      mutate(input: MutableInvariantInput) {
        input.exposure.toolIds = [
          "list_site_visits",
          ...input.exposure.toolIds.slice(1),
        ];
      },
    },
    {
      name: "a missing domain method",
      mutate(input: MutableInvariantInput) {
        const { list_scheduled_jobs: _missing, ...remaining } =
          input.domainMethods;
        input.domainMethods = remaining;
      },
    },
    {
      name: "a missing required scope",
      mutate(input: MutableInvariantInput) {
        input.exposure.grantableScopes = input.exposure.grantableScopes.filter(
          (scope) => scope !== "ops.financials.read"
        );
      },
    },
    {
      name: "an unregistered scope",
      mutate(input: MutableInvariantInput) {
        input.exposure.grantableScopes = [
          ...input.exposure.grantableScopes,
          "ops.unregistered.read",
        ];
        input.consentLabels = {
          ...input.consentLabels,
          "ops.unregistered.read": "See unregistered data",
        };
      },
    },
    {
      name: "a scope without a consent label",
      mutate(input: MutableInvariantInput) {
        const { "ops.jobs.read": _missing, ...remaining } = input.consentLabels;
        input.consentLabels = remaining;
      },
    },
    {
      name: "a labelled but unused scope",
      mutate(input: MutableInvariantInput) {
        input.exposure.grantableScopes = [
          ...input.exposure.grantableScopes,
          "ops.catalog.read",
        ];
        input.consentLabels = {
          ...input.consentLabels,
          "ops.catalog.read": "See catalogue data",
        };
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const input = invariantInput();
    mutate(input);
    expect(() => assertMcpExposureInvariants(input)).toThrow(TypeError);
  });

  it("rejects a read tool that requires a registered write scope", () => {
    const input = invariantInput();
    const [first, ...remaining] = input.manifestEntries;
    const [variant, ...otherVariants] = first!.authorization.variants;
    input.manifestEntries = [
      {
        ...first!,
        authorization: {
          variants: [
            {
              ...variant!,
              policy: {
                ...variant!.policy,
                requiredOAuthScopes: [
                  ...variant!.policy.requiredOAuthScopes,
                  "ops.jobs.write",
                ],
              },
            },
            ...otherVariants,
          ],
        },
      },
      ...remaining,
    ];
    input.exposure.grantableScopes.push("ops.jobs.write");
    input.consentLabels["ops.jobs.write"] = "Modify jobs";

    expect(() => assertMcpExposureInvariants(input)).toThrow(
      "MCP exposure requires a non-read scope"
    );
  });

  it("rejects a registered prepare scope even when it is only grantable", () => {
    const input = invariantInput();
    input.exposure.grantableScopes.push("ops.jobs.prepare");
    input.consentLabels["ops.jobs.prepare"] = "Prepare job changes";

    expect(() => assertMcpExposureInvariants(input)).toThrow(
      "MCP exposure grants a non-read scope"
    );
  });

  it("rejects unknown revisions through the pure catalogue seam without disclosing entries", () => {
    expect(() =>
      resolveMcpExposureRevision(MCP_EXPOSURE_CATALOG, "unknown")
    ).toThrow("Unknown MCP exposure revision");
  });
});
