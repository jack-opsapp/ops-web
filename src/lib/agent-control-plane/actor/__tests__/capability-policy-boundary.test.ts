import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  defineCapabilityPolicyForManifest,
  isManifestCapabilityPolicy,
  type ManifestCapabilityPolicy,
  type ManifestCapabilityPolicyDefinition,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";

const MANIFEST_REVISION = "capabilities:test-v1";

function definition(
  overrides: Partial<ManifestCapabilityPolicyDefinition> = {}
): ManifestCapabilityPolicyDefinition {
  return {
    capabilityId: "get_job_summary",
    capabilityRevision: "get_job_summary:v1",
    capabilityManifestRevision: MANIFEST_REVISION,
    requiredOAuthScopes: ["ops.jobs.read"],
    permissionRequirementGroups: [
      [
        {
          permission: "projects.view",
          allowedScopes: ["all", "assigned"],
        },
      ],
    ],
    ...overrides,
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("manifest capability policy boundary", () => {
  it("mints an immutable nominal policy and does not transfer trust through spread", () => {
    const policy = defineCapabilityPolicyForManifest(definition());

    expect(isManifestCapabilityPolicy(policy)).toBe(true);
    expect(isManifestCapabilityPolicy({ ...policy })).toBe(false);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.requiredOAuthScopes)).toBe(true);
    expect(Object.isFrozen(policy.permissionRequirementGroups)).toBe(true);
    expect(Object.isFrozen(policy.permissionRequirementGroups[0])).toBe(true);
    expect(Object.isFrozen(policy.permissionRequirementGroups[0][0])).toBe(
      true
    );
    expect(
      Object.isFrozen(policy.permissionRequirementGroups[0][0].allowedScopes)
    ).toBe(true);

    if (false) {
      // @ts-expect-error the manifest policy brand cannot be structurally forged
      const forged: ManifestCapabilityPolicy = definition();
      void forged;
    }
  });

  it.each([
    {
      name: "an empty OAuth ceiling",
      value: definition({ requiredOAuthScopes: [] }),
    },
    {
      name: "an empty OPS permission set",
      value: definition({ permissionRequirementGroups: [] }),
    },
    {
      name: "an empty OPS permission alternative",
      value: definition({ permissionRequirementGroups: [[]] }),
    },
    {
      name: "a malformed OAuth scope",
      value: definition({ requiredOAuthScopes: ["ops.jobs.read write"] }),
    },
    {
      name: "a duplicate OAuth scope",
      value: definition({
        requiredOAuthScopes: ["ops.jobs.read", "ops.jobs.read"],
      }),
    },
    {
      name: "an unregistered OPS permission",
      value: definition({
        permissionRequirementGroups: [
          [
            {
              permission: "invented.permission" as never,
              allowedScopes: ["all"],
            },
          ],
        ],
      }),
    },
    {
      name: "a duplicate OPS permission",
      value: definition({
        permissionRequirementGroups: [
          [
            { permission: "projects.view", allowedScopes: ["all"] },
            { permission: "projects.view", allowedScopes: ["assigned"] },
          ],
        ],
      }),
    },
    {
      name: "a duplicate OPS permission alternative",
      value: definition({
        permissionRequirementGroups: [
          [{ permission: "projects.view", allowedScopes: ["all"] }],
          [{ permission: "projects.view", allowedScopes: ["all"] }],
        ],
      }),
    },
    {
      name: "an empty allowed-scope set",
      value: definition({
        permissionRequirementGroups: [
          [{ permission: "projects.view", allowedScopes: [] }],
        ],
      }),
    },
    {
      name: "a duplicate allowed scope",
      value: definition({
        permissionRequirementGroups: [
          [
            {
              permission: "projects.view",
              allowedScopes: ["all", "all"],
            },
          ],
        ],
      }),
    },
    {
      name: "an invalid allowed scope",
      value: definition({
        permissionRequirementGroups: [
          [
            {
              permission: "projects.view",
              allowedScopes: ["cross_company" as never],
            },
          ],
        ],
      }),
    },
  ])("rejects $name", ({ value }) => {
    expect(() => defineCapabilityPolicyForManifest(value)).toThrow(TypeError);
  });

  it("keeps the authority-minting factory at the exact server-owned manifest boundary", () => {
    const sourceRoot = join(process.cwd(), "src");
    const allowedProductionCallers = new Set([
      "lib/agent-control-plane/actor/capability-policy-boundary.ts",
      "lib/agent-control-plane/registry/capability-manifest.ts",
    ]);

    const productionCallers = sourceFiles(sourceRoot)
      .filter((path) => /\.(?:ts|tsx)$/.test(path))
      .filter((path) => !path.includes("/__tests__/"))
      .filter((path) =>
        readFileSync(path, "utf8").includes("defineCapabilityPolicyForManifest")
      )
      .map((path) => relative(sourceRoot, path));

    expect(
      productionCallers.every((path) => allowedProductionCallers.has(path))
    ).toBe(true);
    expect(productionCallers).toContain(
      "lib/agent-control-plane/actor/capability-policy-boundary.ts"
    );
  });
});
