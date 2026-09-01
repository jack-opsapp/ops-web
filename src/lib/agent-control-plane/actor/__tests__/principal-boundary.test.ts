import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isVerifiedActorPrincipal } from "@/lib/agent-control-plane/actor/principal-boundary";
import {
  validatedMcpPrincipalFixture,
  verifiedPhaseCPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "./fixtures/verified-principal-fixtures";

const ACTOR_ROOT = path.join(
  process.cwd(),
  "src",
  "lib",
  "agent-control-plane",
  "actor"
);
const TYPES_PATH = path.join(ACTOR_ROOT, "types.ts");
const PRINCIPAL_BOUNDARY_IMPORT = ["actor", "principal-boundary"].join("/");
const MCP_REAUTHORIZATION_IMPORT = ["mcp", "actor-reauthorization"].join("/");
const PHASE_C_ROUTE = {
  assignmentVersion: 7,
  connectionId: "33333333-3333-4333-8333-333333333333",
  opportunityId: "44444444-4444-4444-8444-444444444444",
  internalThreadId: "55555555-5555-4555-8555-555555555555",
  providerThreadId: "provider-thread-1",
  sourceActivityId: "66666666-6666-4666-8666-666666666666",
  sourceTurnId: "77777777-7777-4777-8777-777777777777",
  sourceConversationId: "88888888-8888-4888-8888-888888888888",
} as const;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
    })
  );
  return files.flat();
}

describe("verified principal source boundary", () => {
  it("does not transfer verified authority through an object spread", () => {
    const verified = verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-subject-1",
    });

    expect(isVerifiedActorPrincipal(verified)).toBe(true);
    expect(isVerifiedActorPrincipal({ ...verified })).toBe(false);
  });

  it("mints routed Phase C identity without accepting malformed actor or company IDs", () => {
    const principal = verifiedPhaseCPrincipalFixture({
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      applicationId: "phase-c",
      protocolEra: "internal-v1",
      ...PHASE_C_ROUTE,
    });

    expect(principal).toMatchObject({
      kind: "phase_c",
      channel: "internal",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      phaseCRoute: PHASE_C_ROUTE,
    });
    expect(Object.isFrozen(principal.phaseCRoute)).toBe(true);
    expect(isVerifiedActorPrincipal(principal)).toBe(true);
    expect(isVerifiedActorPrincipal({ ...principal })).toBe(false);
    expect(() =>
      verifiedPhaseCPrincipalFixture({
        actorUserId: "not-a-uuid",
        companyId: "22222222-2222-4222-8222-222222222222",
        ...PHASE_C_ROUTE,
      })
    ).toThrow(TypeError);
    expect(() =>
      verifiedPhaseCPrincipalFixture({
        actorUserId: "11111111-1111-4111-8111-111111111111",
        companyId: "22222222-2222-4222-8222-222222222222",
        ...PHASE_C_ROUTE,
        providerThreadId: "é".repeat(257),
      })
    ).toThrow(TypeError);
  });

  it("rejects malformed MCP identity and OAuth scope claims at the trusted boundary", () => {
    const valid = {
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      oauthGrantId: "grant-1",
      oauthClientId: "client-1",
      validatedScopes: ["ops.jobs.read"],
      tokenId: "token-1",
      issuer: "https://auth.opsapp.co",
      audience: "https://mcp.opsapp.co/mcp",
      grantRevision: "grant-revision-1",
    } as const;

    expect(() =>
      validatedMcpPrincipalFixture({
        ...valid,
        actorUserId: "not-a-uuid",
      })
    ).toThrow(TypeError);
    expect(() =>
      validatedMcpPrincipalFixture({
        ...valid,
        validatedScopes: ['ops.jobs.read"\r\nX-Injected: true'],
      })
    ).toThrow(TypeError);
  });

  it("does not expose authority-minting factories from the general actor types module", async () => {
    const typesUrl = pathToFileURL(TYPES_PATH).href;
    const actorTypes = (await import(/* @vite-ignore */ typesUrl)) as Record<
      string,
      unknown
    >;

    for (const factoryName of [
      "createInternalPrincipalFromVerifiedFirebase",
      "createInternalPrincipalFromVerifiedPhaseCRouting",
      "createMcpPrincipalFromValidatedGrant",
      "createVerifiedInternalPrincipal",
      "createValidatedMcpPrincipal",
    ]) {
      expect(actorTypes).not.toHaveProperty(factoryName);
    }
  });

  it("allows the trusted principal boundary only in auth adapters and tests", async () => {
    const files = await sourceFiles(path.join(process.cwd(), "src"));
    const violations: string[] = [];

    for (const file of files) {
      const relative = path.relative(process.cwd(), file);
      const isTest = /(?:__tests__|\.test\.|\.spec\.)/.test(relative);
      const isApprovedAdapter =
        relative === "src/lib/agent-control-plane/adapters/internal.ts" ||
        relative.startsWith("src/lib/agent-control-plane/adapters/internal/") ||
        relative.startsWith("src/lib/agent-control-plane/oauth/") ||
        // The MCP transport's bearer gate: resolves a validated OAuth grant
        // row to the branded principal. Exactly one file, not the mcp/ tree.
        relative === "src/lib/agent-control-plane/mcp/bearer.ts" ||
        // Exact reauthorization adapter for an already resolved MCP actor or
        // a database-authorized OPS routine claim. Domain services cannot mint.
        relative === "src/lib/agent-control-plane/mcp/actor-reauthorization.ts";
      const isBoundaryItself = relative.endsWith(
        "src/lib/agent-control-plane/actor/principal-boundary.ts"
      );
      const isPrincipalConsumer = relative.endsWith(
        "src/lib/agent-control-plane/actor/resolve-actor-context.ts"
      );
      if (
        isTest ||
        isApprovedAdapter ||
        isBoundaryItself ||
        isPrincipalConsumer
      ) {
        continue;
      }

      const contents = await readFile(file, "utf8");
      if (contents.includes(PRINCIPAL_BOUNDARY_IMPORT)) {
        violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  }, 20_000);

  it("allows the MCP reauthorization adapter only at exact composition and domain seams", async () => {
    const files = await sourceFiles(path.join(process.cwd(), "src"));
    const approvedConsumers = new Set([
      "src/app/api/cron/day-closeout-routines/route.ts",
      "src/lib/agent-control-plane/services/collections/collections-service.ts",
      "src/lib/agent-control-plane/services/day-closeout/day-closeout-routine-service.ts",
      "src/lib/agent-control-plane/services/day-closeout/day-closeout-service.ts",
      "src/lib/agent-control-plane/services/hiring-what-if/hiring-what-if-service.ts",
      "src/lib/agent-control-plane/services/payroll-readiness/payroll-readiness-service.ts",
      "src/lib/agent-control-plane/services/promise-recovery/promise-recovery-service.ts",
      "src/lib/agent-control-plane/services/sales-truth/sales-truth-service.ts",
    ]);
    const violations: string[] = [];

    for (const file of files) {
      const relative = path.relative(process.cwd(), file);
      if (/(?:__tests__|\.test\.|\.spec\.)/.test(relative)) continue;
      const contents = await readFile(file, "utf8");
      if (
        contents.includes(MCP_REAUTHORIZATION_IMPORT) &&
        !approvedConsumers.has(relative)
      ) {
        violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  }, 20_000);
});
