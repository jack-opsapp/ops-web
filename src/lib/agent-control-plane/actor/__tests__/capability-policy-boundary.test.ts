import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  activateCapabilityPolicyForManifest,
  defineCapabilityPolicyForManifest,
  isActiveManifestCapabilityPolicy,
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
    expect(isActiveManifestCapabilityPolicy(policy)).toBe(false);
    expect(isManifestCapabilityPolicy({ ...policy })).toBe(false);
    expect(() =>
      activateCapabilityPolicyForManifest({ ...policy } as never)
    ).toThrow(TypeError);
    expect(activateCapabilityPolicyForManifest(policy)).toBe(policy);
    expect(isActiveManifestCapabilityPolicy(policy)).toBe(true);
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

  it("keeps nominal policy minting inside the manifest and closed P2 definition harness", () => {
    const sourceRoot = join(process.cwd(), "src");
    const allowedProductionCallers = new Set([
      "lib/agent-control-plane/actor/capability-policy-boundary.ts",
      "lib/agent-control-plane/registry/capability-manifest.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/candidate-policy.ts",
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

  it("keeps policy activation at the exact central manifest boundary", () => {
    const sourceRoot = join(process.cwd(), "src");
    const allowedProductionCallers = new Set([
      "lib/agent-control-plane/actor/capability-policy-boundary.ts",
      "lib/agent-control-plane/registry/capability-manifest.ts",
    ]);

    const productionCallers = sourceFiles(sourceRoot)
      .filter((path) => /\.(?:ts|tsx)$/.test(path))
      .filter((path) => !path.includes("/__tests__/"))
      .filter((path) =>
        readFileSync(path, "utf8").includes(
          "activateCapabilityPolicyForManifest"
        )
      )
      .map((path) => relative(sourceRoot, path));

    expect(new Set(productionCallers)).toEqual(allowedProductionCallers);
  });

  it("keeps the P2 candidate minter inside the exact closed definition set", () => {
    const sourceRoot = join(process.cwd(), "src");
    const allowedProductionCallers = new Set([
      "lib/agent-control-plane/registry/read-capabilities/p2/artifacts.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/availability.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/candidate-policy.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/catalog.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/company.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/customer-context.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/deck-design.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/expenses.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/integrations.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/overview.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/payments.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/purchasing.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/sales.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/site-visits.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/tasks.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/team.ts",
      "lib/agent-control-plane/registry/read-capabilities/p2/work-queue.ts",
    ]);

    const productionCallers = sourceFiles(sourceRoot)
      .filter((path) => /\.(?:ts|tsx)$/.test(path))
      .filter((path) => !path.includes("/__tests__/"))
      .filter((path) =>
        readFileSync(path, "utf8").includes("mintP2CandidateCapability")
      )
      .map((path) => relative(sourceRoot, path));

    expect(new Set(productionCallers)).toEqual(allowedProductionCallers);
  });
});
