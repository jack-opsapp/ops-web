import { describe, expect, it } from "vitest";

import {
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST,
  WEATHER_RESCHEDULE_CAPABILITY_MANIFEST,
  WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION,
  getWeatherRescheduleCapabilityManifestEntry,
  resolveWeatherRescheduleCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V10,
  MCP_EXPOSURE_V11,
  capabilityManifestRevisionForExposure,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";
import { WEATHER_RESCHEDULE_MCP_SCOPE_CONSENT_LABELS } from "../mcp-scope-catalog";

describe("weather reschedule dormant capability", () => {
  it("adds one exact prepare capability with no schedule mutation or send twin", () => {
    const entry = getWeatherRescheduleCapabilityManifestEntry(
      "prepare_weather_reschedule"
    );
    expect(entry).toMatchObject({
      schemaRevision: "2026-09-03.v1",
      operation: "prepare",
      writeFamily: "weather_reschedule",
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
      WEATHER_RESCHEDULE_CAPABILITY_MANIFEST.some(
        (candidate) =>
          candidate.writeFamily === "weather_reschedule" &&
          candidate.operation === "commit"
      )
    ).toBe(false);
  });

  it("owns the exact seven-scope and nine-permission owner policy", () => {
    const resolved = resolveWeatherRescheduleCapabilityAuthorization(
      "prepare_weather_reschedule",
      { target_date: "2026-09-03" }
    );
    expect(resolved.parsedInput).toEqual({ target_date: "2026-09-03" });
    expect(resolved.variants).toHaveLength(1);
    expect(resolved.variants[0]!.policy).toMatchObject({
      capabilityManifestRevision:
        WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION,
      requiredOAuthScopes: [
        "ops.communications.prepare",
        "ops.company.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.jobs.read",
        "ops.schedule.prepare",
        "ops.schedule.read",
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
          { permission: "tasks.edit", allowedScopes: ["all"] },
          { permission: "tasks.view", allowedScopes: ["all"] },
        ],
      ],
    });
  });

  it("makes v11 additive to v10 while production remains exactly v2", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(MCP_EXPOSURE_V2.revision);
    expect(MCP_EXPOSURE_V11.toolIds).toEqual([
      ...MCP_EXPOSURE_V10.toolIds,
      "prepare_weather_reschedule",
    ]);
    expect(MCP_EXPOSURE_V11.grantableScopes).toEqual([
      "ops.catalog.read",
      "ops.communications.prepare",
      "ops.company.read",
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.expenses.read",
      "ops.financial_documents.read",
      "ops.financials.prepare",
      "ops.financials.read",
      "ops.jobs.read",
      "ops.operations.prepare",
      "ops.operations.read",
      "ops.payments.read",
      "ops.schedule.prepare",
      "ops.schedule.read",
      "ops.site_visits.read",
      "ops.tasks.read",
      "ops.team.read",
    ]);
    expect(resolveMcpExposure(MCP_EXPOSURE_V11.revision)).toBe(
      MCP_EXPOSURE_V11
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V11.revision)
    ).toBe(WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION);
    expect(
      WEATHER_RESCHEDULE_MCP_SCOPE_CONSENT_LABELS["ops.communications.prepare"]
    ).toBe("Prepare exact client schedule-update drafts for approval");
    expect(
      WEATHER_RESCHEDULE_MCP_SCOPE_CONSENT_LABELS["ops.schedule.prepare"]
    ).toBe("Prepare exact weather reschedule proposals for approval");
  });

  it("remints v16 at v17 without changing the v16 bytes", () => {
    const frozenV16 = JSON.stringify(ESTIMATE_DRAFT_CAPABILITY_MANIFEST);
    expect(WEATHER_RESCHEDULE_CAPABILITY_MANIFEST).toHaveLength(
      ESTIMATE_DRAFT_CAPABILITY_MANIFEST.length + 1
    );
    for (const previous of ESTIMATE_DRAFT_CAPABILITY_MANIFEST) {
      const reminted = getWeatherRescheduleCapabilityManifestEntry(
        previous.name
      );
      expect(reminted).not.toBe(previous);
      expect(
        reminted.authorization.variants.every(
          (variant) =>
            variant.policy.capabilityManifestRevision ===
            WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION
        )
      ).toBe(true);
    }
    expect(JSON.stringify(ESTIMATE_DRAFT_CAPABILITY_MANIFEST)).toBe(frozenV16);
    expect(Object.isFrozen(WEATHER_RESCHEDULE_CAPABILITY_MANIFEST)).toBe(true);
  });
});
