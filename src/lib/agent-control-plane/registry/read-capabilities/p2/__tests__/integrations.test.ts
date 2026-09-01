import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  GET_INTEGRATION_HEALTH_CANDIDATE,
  INTEGRATION_HEALTH_AUTHORIZATION_VARIANT_KEYS,
  selectedIntegrationHealthVariantKeys,
} from "../integrations";

describe("P2 integration-health candidate", () => {
  it("pins independent accounting and mailbox authorization ceilings", () => {
    expect(INTEGRATION_HEALTH_AUTHORIZATION_VARIANT_KEYS).toEqual([
      "accounting",
      "mailbox",
    ]);
    expect(
      GET_INTEGRATION_HEALTH_CANDIDATE.authorization.variants.map(
        (variant) => ({
          key: variant.key,
          scopes: variant.policy.requiredOAuthScopes,
          groups: variant.policy.permissionRequirementGroups,
        })
      )
    ).toEqual([
      {
        key: "accounting",
        scopes: ["ops.integrations.read"],
        groups: [
          [
            { permission: "accounting.view", allowedScopes: ["all"] },
            { permission: "settings.integrations", allowedScopes: ["all"] },
          ],
        ],
      },
      {
        key: "mailbox",
        scopes: ["ops.integrations.read"],
        groups: [
          [
            { permission: "email.view", allowedScopes: ["all", "own"] },
            { permission: "settings.integrations", allowedScopes: ["all"] },
          ],
        ],
      },
    ]);
  });

  it("selects every explicitly requested branch once and in canonical order", () => {
    expect(
      selectedIntegrationHealthVariantKeys({
        integrations: [
          { integration_type: "accounting", provider: "quickbooks" },
        ],
      })
    ).toEqual(["accounting"]);
    expect(
      selectedIntegrationHealthVariantKeys({
        integrations: [{ integration_type: "mailbox", provider: "gmail" }],
      })
    ).toEqual(["mailbox"]);
    expect(
      selectedIntegrationHealthVariantKeys({
        integrations: [
          { integration_type: "accounting", provider: "sage" },
          { integration_type: "mailbox", provider: "microsoft365" },
        ],
      })
    ).toEqual(["accounting", "mailbox"]);
  });

  it("stays dark, read-only, immutable, and bounded", () => {
    expect(GET_INTEGRATION_HEALTH_CANDIDATE).toMatchObject({
      name: "get_integration_health",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      riskTier: "high",
      bounds: {
        maxInputBytes: 4_096,
        maxOutputCharacters: 60_000,
        maxResultItems: 4,
      },
      evidencePolicy: {
        output: "required",
        maxEvidenceRefs: 4,
        promptSafeOutput: true,
        untrustedExternalContent: "structured_and_marked",
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      confirmationPolicy: { kind: "not_required" },
      idempotencyPolicy: { kind: "inherent" },
      availability: { implementation: "available" },
      rolloutFlag: "agent_control_plane.capability.get_integration_health",
    });
    expect(Object.isFrozen(GET_INTEGRATION_HEALTH_CANDIDATE)).toBe(true);
    expect(
      CAPABILITY_MANIFEST.find(
        (entry) => entry.name === GET_INTEGRATION_HEALTH_CANDIDATE.name
      )
    ).toBe(GET_INTEGRATION_HEALTH_CANDIDATE);
  });
});
