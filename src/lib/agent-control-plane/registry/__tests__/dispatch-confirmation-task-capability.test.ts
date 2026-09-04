import { describe, expect, it } from "vitest";

import {
  CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST,
  DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST,
  DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION,
  getDispatchConfirmationTaskCapabilityManifestEntry,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V12,
  MCP_EXPOSURE_V13,
  capabilityManifestRevisionForExposure,
} from "../mcp-exposure-catalog";

describe("dispatch confirmation task dormant capability", () => {
  it("adds prepare and commit authority but exposes only preparation", () => {
    expect(
      getDispatchConfirmationTaskCapabilityManifestEntry(
        "prepare_dispatch_confirmation_task"
      )
    ).toMatchObject({
      operation: "prepare",
      writeFamily: "dispatch_confirmation_task",
      riskTier: "high",
      confirmationPolicy: {
        kind: "change_set_preview",
        exactPreviewRequired: true,
        expires: true,
      },
    });
    expect(
      getDispatchConfirmationTaskCapabilityManifestEntry(
        "commit_dispatch_confirmation_task"
      )
    ).toMatchObject({
      operation: "commit",
      writeFamily: "dispatch_confirmation_task",
      confirmationPolicy: {
        kind: "confirmation_receipt",
        prepareCapability: "prepare_dispatch_confirmation_task",
        exactPreviewRequired: true,
        singleUse: true,
      },
    });
    expect(MCP_EXPOSURE_V13.toolIds).toEqual([
      ...MCP_EXPOSURE_V12.toolIds,
      "prepare_dispatch_confirmation_task",
    ]);
    expect(MCP_EXPOSURE_V13.toolIds).not.toContain(
      "commit_dispatch_confirmation_task"
    );
  });

  it("keeps production v2 immutable and remints v18 into v19", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(MCP_EXPOSURE_V2.revision);
    expect(DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-09-03.capability-manifest.v19"
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V13.revision)
    ).toBe(DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION);
    expect(DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST).toHaveLength(
      CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST.length + 2
    );
  });

  it("requires exact read, review, task, assignment, and prepare authority", () => {
    const entry = getDispatchConfirmationTaskCapabilityManifestEntry(
      "prepare_dispatch_confirmation_task"
    );
    expect(entry.authorization.variants[0]!.policy).toMatchObject({
      requiredOAuthScopes: [
        "ops.company.read",
        "ops.jobs.read",
        "ops.operations.prepare",
        "ops.operations.read",
        "ops.schedule.read",
        "ops.tasks.read",
      ],
      permissionRequirementGroups: [
        [
          { permission: "agent.review", allowedScopes: ["all"] },
          { permission: "projects.view", allowedScopes: ["all"] },
          { permission: "tasks.assign", allowedScopes: ["all"] },
          { permission: "tasks.create", allowedScopes: ["all"] },
          { permission: "tasks.view", allowedScopes: ["all"] },
        ],
      ],
    });
  });
});
