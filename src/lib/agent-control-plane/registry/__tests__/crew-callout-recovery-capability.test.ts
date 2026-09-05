import { describe, expect, it } from "vitest";

import {
  CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST,
  CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION,
  WEATHER_RESCHEDULE_CAPABILITY_MANIFEST,
  getCrewCalloutRecoveryCapabilityManifestEntry,
  resolveCrewCalloutRecoveryCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V11,
  MCP_EXPOSURE_V12,
  capabilityManifestRevisionForExposure,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";
import { CREW_CALLOUT_RECOVERY_MCP_SCOPE_CONSENT_LABELS } from "../mcp-scope-catalog";

describe("crew call-out recovery dormant capability", () => {
  it("adds one prepare-only capability with no mutation or send twin", () => {
    const entry = getCrewCalloutRecoveryCapabilityManifestEntry(
      "prepare_crew_callout_recovery"
    );
    expect(entry).toMatchObject({
      schemaRevision: "2026-09-03.v1",
      operation: "prepare",
      writeFamily: "crew_callout_recovery",
      riskTier: "high",
      auditClass: "mutation_prepare",
      rateLimitBucket: "prepare",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      confirmationPolicy: {
        kind: "change_set_preview",
        exactPreviewRequired: true,
        expires: true,
      },
      idempotencyPolicy: { kind: "inherent" },
    });
    expect(
      CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST.some(
        (candidate) =>
          candidate.writeFamily === "crew_callout_recovery" &&
          candidate.operation === "commit"
      )
    ).toBe(false);
  });

  it("requires the exact scheduling, team, entity, and draft authority", () => {
    const resolved = resolveCrewCalloutRecoveryCapabilityAuthorization(
      "prepare_crew_callout_recovery",
      { crew_member_name: "Mike", target_date: "2026-09-04" }
    );
    expect(resolved.parsedInput).toEqual({
      crew_member_name: "Mike",
      target_date: "2026-09-04",
    });
    expect(resolved.variants[0]!.policy).toMatchObject({
      capabilityManifestRevision:
        CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION,
      requiredOAuthScopes: [
        "ops.communications.prepare",
        "ops.company.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
        "ops.schedule.prepare",
        "ops.schedule.read",
        "ops.site_visits.read",
        "ops.tasks.read",
        "ops.team.read",
      ],
      permissionRequirementGroups: [
        [
          { permission: "calendar.edit", allowedScopes: ["all"] },
          { permission: "calendar.view", allowedScopes: ["all"] },
          { permission: "clients.view", allowedScopes: ["all"] },
          { permission: "inbox.send", allowedScopes: ["all"] },
          { permission: "inbox.view", allowedScopes: ["all"] },
          { permission: "projects.edit", allowedScopes: ["all"] },
          { permission: "projects.view", allowedScopes: ["all"] },
          { permission: "tasks.assign", allowedScopes: ["all"] },
          { permission: "tasks.edit", allowedScopes: ["all"] },
          { permission: "tasks.view", allowedScopes: ["all"] },
          { permission: "team.view", allowedScopes: ["all"] },
        ],
      ],
    });
  });

  it("makes v12 additive to v11 while the historical v2 catalogue stays immutable", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe("2026-09-04.mcp-exposure.v14");
    expect(MCP_EXPOSURE_V12.toolIds).toEqual([
      ...MCP_EXPOSURE_V11.toolIds,
      "prepare_crew_callout_recovery",
    ]);
    expect(MCP_EXPOSURE_V12.grantableScopes).toEqual(
      MCP_EXPOSURE_V11.grantableScopes
    );
    expect(resolveMcpExposure(MCP_EXPOSURE_V12.revision)).toBe(
      MCP_EXPOSURE_V12
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V12.revision)
    ).toBe(CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION);
    expect(
      CREW_CALLOUT_RECOVERY_MCP_SCOPE_CONSENT_LABELS["ops.schedule.prepare"]
    ).toBe(
      "Prepare exact weather and crew recovery schedule proposals for approval"
    );
    expect(
      CREW_CALLOUT_RECOVERY_MCP_SCOPE_CONSENT_LABELS[
        "ops.communications.prepare"
      ]
    ).toBe(
      "Prepare exact client schedule-update and crew recovery messages for approval"
    );
  });

  it("remints v17 at v18 without changing the v17 bytes", () => {
    const frozenV17 = JSON.stringify(WEATHER_RESCHEDULE_CAPABILITY_MANIFEST);
    expect(CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST).toHaveLength(
      WEATHER_RESCHEDULE_CAPABILITY_MANIFEST.length + 1
    );
    for (const previous of WEATHER_RESCHEDULE_CAPABILITY_MANIFEST) {
      const reminted = getCrewCalloutRecoveryCapabilityManifestEntry(
        previous.name
      );
      expect(reminted).not.toBe(previous);
      expect(
        reminted.authorization.variants.every(
          (variant) =>
            variant.policy.capabilityManifestRevision ===
            CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION
        )
      ).toBe(true);
    }
    expect(JSON.stringify(WEATHER_RESCHEDULE_CAPABILITY_MANIFEST)).toBe(
      frozenV17
    );
    expect(Object.isFrozen(CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST)).toBe(
      true
    );
  });
});
