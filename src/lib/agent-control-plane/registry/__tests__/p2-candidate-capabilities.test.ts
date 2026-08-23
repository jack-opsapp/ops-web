import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod-v4";

import { isManifestCapabilityPolicy } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  RESERVED_P2_MANIFEST_REVISION,
  mintP2CandidateCapability,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2";
import { CAPABILITY_MANIFEST } from "../capability-manifest";
import type { ImplementationOnlyCapabilityDefinition } from "../capability-types";

const CANDIDATE_NAME = "get_p2_candidate_fixture";

function candidateDefinition(): ImplementationOnlyCapabilityDefinition {
  return {
    name: CANDIDATE_NAME,
    schemaRevision: "2026-08-22.v1",
    operation: "read",
    description: "Returns one isolated P2 candidate fixture.",
    inputSchema: z.object({ fixture_id: z.uuid() }).strict(),
    riskTier: "low",
    bounds: {
      maxInputBytes: 1_024,
      maxOutputCharacters: 60_000,
      maxResultItems: 1,
    },
    evidencePolicy: {
      input: "required",
      output: "required",
      maxEvidenceRefs: 1,
      promptSafeOutput: true,
      untrustedExternalContent: "structured_and_marked",
    },
    auditClass: "operational_read",
    rateLimitBucket: "lightweight_read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    confirmationPolicy: { kind: "not_required" },
    idempotencyPolicy: { kind: "inherent" },
    availability: { implementation: "available" },
    rolloutFlag: "mcp_p2_candidate_fixture_enabled",
    authorization: {
      variants: [
        {
          key: "always",
          selector: { kind: "always" },
          requiredOAuthScopes: ["ops.jobs.read"],
          permissionRequirementGroups: [
            [{ permission: "projects.view", allowedScopes: ["all"] }],
          ],
        },
      ],
    },
  };
}

function candidateWithOAuthScope(
  scope: string
): ImplementationOnlyCapabilityDefinition {
  const definition = candidateDefinition();
  const [variant] = definition.authorization.variants;
  return {
    ...definition,
    authorization: {
      variants: [
        {
          ...variant!,
          requiredOAuthScopes: [scope],
        },
      ],
    },
  };
}

describe("P2 isolated candidate policy harness", () => {
  it("mints final-identity nominal policy bytes without mutating v7", () => {
    const v7NamesBefore = CAPABILITY_MANIFEST.map((entry) => entry.name);
    const candidate = mintP2CandidateCapability(candidateDefinition());

    expect(RESERVED_P2_MANIFEST_REVISION).toBe(
      "2026-08-22.capability-manifest.v8"
    );
    expect(candidate.name).toBe(CANDIDATE_NAME);
    expect(candidate.availability).toEqual({ implementation: "available" });
    expect(Object.keys(candidate.availability)).toEqual(["implementation"]);
    expect(candidate.authorization.variants).toHaveLength(1);

    const policy = candidate.authorization.variants[0]!.policy;
    expect(isManifestCapabilityPolicy(policy)).toBe(true);
    expect(policy).toMatchObject({
      capabilityId: CANDIDATE_NAME,
      capabilityRevision: `${CANDIDATE_NAME}:2026-08-22.v1`,
      capabilityManifestRevision: RESERVED_P2_MANIFEST_REVISION,
      requiredOAuthScopes: ["ops.jobs.read"],
    });

    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.bounds)).toBe(true);
    expect(Object.isFrozen(candidate.availability)).toBe(true);
    expect(Object.isFrozen(candidate.authorization)).toBe(true);
    expect(Object.isFrozen(candidate.authorization.variants)).toBe(true);
    expect(Object.isFrozen(candidate.authorization.variants[0])).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.permissionRequirementGroups)).toBe(true);
    expect(Object.isFrozen(policy.permissionRequirementGroups[0])).toBe(true);

    expect(CAPABILITY_MANIFEST.map((entry) => entry.name)).toEqual(
      v7NamesBefore
    );
    expect(
      CAPABILITY_MANIFEST.some((entry) => entry.name === CANDIDATE_NAME)
    ).toBe(false);
  });

  it("rejects exposure state, writes, and generic capability escape hatches", () => {
    const exposed =
      candidateDefinition() as ImplementationOnlyCapabilityDefinition & {
        availability: {
          implementation: "available";
          externalExposure: "enabled";
        };
      };
    exposed.availability = {
      implementation: "available",
      externalExposure: "enabled",
    };
    expect(() => mintP2CandidateCapability(exposed)).toThrow(
      "P2_CANDIDATE_AVAILABILITY_INVALID"
    );

    expect(() =>
      mintP2CandidateCapability({
        ...candidateDefinition(),
        operation: "prepare",
      })
    ).toThrow("P2_CANDIDATE_MUST_BE_READ_ONLY");
    expect(() =>
      mintP2CandidateCapability({
        ...candidateDefinition(),
        name: "raw_database_query",
      })
    ).toThrow("P2_CANDIDATE_NAME_INVALID");
  });

  it.each(["ops.jobs.write", "ops.jobs.prepare", "ops.unknown.read"])(
    "rejects non-read or unregistered OAuth scope %s before policy minting",
    (scope) => {
      expect(() =>
        mintP2CandidateCapability(candidateWithOAuthScope(scope))
      ).toThrow("P2_CANDIDATE_OAUTH_SCOPE_INVALID");
    }
  );

  it("has no aggregate, manifest, dispatch, OAuth, grant, or exposure dependency", () => {
    const modulePath = path.join(
      process.cwd(),
      "src/lib/agent-control-plane/registry/read-capabilities/p2/candidate-policy.ts"
    );
    const implementation = readFileSync(modulePath, "utf8");
    const importSpecifiers = [
      ...implementation.matchAll(/from\s+["']([^"']+)/g),
    ]
      .map((match) => match[1])
      .filter((specifier): specifier is string => specifier !== undefined);
    for (const forbiddenImport of [
      "capability-manifest",
      "mcp-exposure-catalog",
      "domain-dispatch",
      "server-factory",
      "/mcp/oauth/",
      "/mcp/grant",
    ]) {
      expect(
        importSpecifiers.some((specifier) =>
          specifier.includes(forbiddenImport)
        )
      ).toBe(false);
    }
    expect(implementation).not.toMatch(
      /export\s+const\s+(?:P2_)?(?:CANDIDATES|CAPABILITIES|MANIFEST|REGISTRY)\b/
    );
  });
});
