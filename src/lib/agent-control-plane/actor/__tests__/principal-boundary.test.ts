import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isVerifiedActorPrincipal } from "@/lib/agent-control-plane/actor/principal-boundary";
import {
  validatedMcpPrincipalFixture,
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
        relative.startsWith("src/lib/agent-control-plane/adapters/internal/") ||
        relative.startsWith("src/lib/agent-control-plane/oauth/");
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
  });
});
