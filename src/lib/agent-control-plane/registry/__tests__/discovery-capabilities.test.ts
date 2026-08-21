import { describe, expect, it } from "vitest";

import {
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
  MAX_DISCOVERY_MATCHES,
  MAX_DISCOVERY_OUTPUT_CHARACTERS,
} from "@/lib/agent-control-plane/contracts/discovery";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "../capability-manifest";

const EXPECTED_MANIFEST_REVISION = "2026-08-20.capability-manifest.v7" as const;

function requirementLabels(
  resolved: ReturnType<typeof resolveCapabilityAuthorization>
) {
  return resolved.variants.map((variant) => ({
    key: variant.key,
    oauth: [...variant.policy.requiredOAuthScopes],
    groups: variant.policy.permissionRequirementGroups.map((group) =>
      group.map(
        (requirement) =>
          `${requirement.permission}:${requirement.allowedScopes.join(",")}`
      )
    ),
  }));
}

describe("discovery manifest v7", () => {
  it("mints every policy under immutable v7 while both discovery reads remain dark", () => {
    expect(CAPABILITY_MANIFEST_REVISION).toBe(EXPECTED_MANIFEST_REVISION);
    expect(Object.isFrozen(CAPABILITY_MANIFEST)).toBe(true);

    for (const capability of CAPABILITY_MANIFEST) {
      expect(Object.isFrozen(capability)).toBe(true);
      for (const variant of capability.authorization.variants) {
        expect(Object.isFrozen(variant)).toBe(true);
        expect(variant.policy.capabilityManifestRevision).toBe(
          EXPECTED_MANIFEST_REVISION
        );
      }
    }

    expect(getCapabilityManifestEntry("search_customers")).toMatchObject({
      schemaRevision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
      operation: "read",
      riskTier: "high",
      bounds: {
        maxInputBytes: 32_768,
        maxOutputCharacters: MAX_DISCOVERY_OUTPUT_CHARACTERS,
        maxResultItems: MAX_DISCOVERY_MATCHES,
      },
      auditClass: "search_read",
      rateLimitBucket: "evidence_search",
      availability: {
        implementation: "unavailable",
        externalExposure: "disabled",
      },
    });
    expect(getCapabilityManifestEntry("search_jobs")).toMatchObject({
      schemaRevision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
      operation: "read",
      riskTier: "medium",
      bounds: {
        maxInputBytes: 32_768,
        maxOutputCharacters: MAX_DISCOVERY_OUTPUT_CHARACTERS,
        maxResultItems: MAX_DISCOVERY_MATCHES,
        maxWindowDays: 365,
      },
      auditClass: "search_read",
      rateLimitBucket: "evidence_search",
      availability: {
        implementation: "unavailable",
        externalExposure: "disabled",
      },
    });
  });

  it("selects one name policy without contact authority", () => {
    expect(
      requirementLabels(
        resolveCapabilityAuthorization("search_customers", {
          lookup: "name",
          query: "Acme Construction",
        })
      )
    ).toEqual([
      {
        key: "name",
        oauth: ["ops.customers.read"],
        groups: [["clients.view:all,assigned"]],
      },
    ]);
  });

  it.each([
    ["exact_email", "office@example.com"],
    ["exact_phone", "+16045550199"],
  ] as const)(
    "selects one stronger exact-contact policy for %s",
    (lookup, query) => {
      expect(
        requirementLabels(
          resolveCapabilityAuthorization("search_customers", {
            lookup,
            query,
          })
        )
      ).toEqual([
        {
          key: "exact_contact",
          oauth: ["ops.customer_contacts.read", "ops.customers.read"],
          groups: [["clients.view:all,assigned"]],
        },
      ]);
    }
  );

  it("selects every requested job-kind policy cumulatively", () => {
    expect(
      requirementLabels(
        resolveCapabilityAuthorization("search_jobs", { query: "Cedar deck" })
      )
    ).toEqual([
      {
        key: "opportunity_jobs",
        oauth: ["ops.jobs.read"],
        groups: [["pipeline.view:all,assigned"]],
      },
      {
        key: "project_jobs",
        oauth: ["ops.jobs.read"],
        groups: [["projects.view:all,assigned"]],
      },
    ]);

    expect(
      resolveCapabilityAuthorization("search_jobs", {
        lifecycle_states: ["active"],
        job_kinds: ["opportunity"],
      }).variants.map(({ key }) => key)
    ).toEqual(["opportunity_jobs"]);
  });

  it("rejects malformed discovery input before exposing any policy", () => {
    let selectedPolicies = 0;
    const select = (
      capabilityId: "search_customers" | "search_jobs",
      raw: unknown
    ) => {
      const resolved = resolveCapabilityAuthorization(capabilityId, raw);
      selectedPolicies += resolved.variants.length;
      return resolved;
    };

    expect(() =>
      select("search_customers", {
        lookup: "partial_email",
        query: "@example.com",
      })
    ).toThrow();
    expect(() => select("search_jobs", {})).toThrow();
    expect(selectedPolicies).toBe(0);
  });
});
