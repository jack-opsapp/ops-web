import { describe, expect, it } from "vitest";

import {
  CAPABILITY_MANIFEST_REVISION,
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";

const OPPORTUNITY_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";

function permissionMatrix(kind: "opportunity" | "project") {
  const resolved = resolveCapabilityAuthorization(
    "get_job_conversation_context",
    {
      job_ref: {
        kind,
        id: kind === "opportunity" ? OPPORTUNITY_ID : PROJECT_ID,
      },
    }
  );

  expect(resolved.variants).toHaveLength(1);
  return resolved.variants[0]!.policy.permissionRequirementGroups.map((group) =>
    group.map(
      (requirement) =>
        `${requirement.permission}:${requirement.allowedScopes.join(",")}`
    )
  );
}

describe("get_job_conversation_context capability", () => {
  it("bumps the manifest revision when its authority contract changes", () => {
    expect(CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-12.capability-manifest.v4"
    );
  });

  it("requires full inbox visibility plus current job and customer visibility", () => {
    expect(permissionMatrix("opportunity")).toEqual([
      ["clients.view:all", "inbox.view:all", "pipeline.view:all,assigned"],
    ]);
    expect(permissionMatrix("project")).toEqual([
      ["clients.view:all", "inbox.view:all", "projects.view:all,assigned"],
    ]);
  });

  it("normalizes the default bounded context request in the manifest", () => {
    const capability = getCapabilityManifestEntry(
      "get_job_conversation_context"
    );
    expect(
      capability.inputSchema.parse({
        job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
      })
    ).toEqual({
      job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
      exact_turn_limit: 20,
      sections: [
        "memory",
        "recent_turns",
        "participants",
        "gaps",
        "cross_job_seed",
      ],
    });

    expect(() =>
      capability.inputSchema.parse({
        job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
        exact_turn_limit: 51,
      })
    ).toThrow();
    expect(() =>
      capability.inputSchema.parse({
        job_ref: { kind: "opportunity", id: "not-a-database-id" },
      })
    ).toThrow();
    expect(() =>
      capability.inputSchema.parse({
        job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
        required_through_turn_id: "not-a-turn-id",
      })
    ).toThrow();
  });

  it("is available to the shared service while external exposure remains disabled", () => {
    expect(
      getCapabilityManifestEntry("get_job_conversation_context").availability
    ).toEqual({
      implementation: "available",
      externalExposure: "disabled",
    });
  });
});
