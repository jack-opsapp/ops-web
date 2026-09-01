import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  EVIDENCE_TOKEN_MAX_TTL_SECONDS,
  EvidenceTokenError,
  createMcpEvidenceTokenCodec,
  mcpEvidenceSigningConfigured,
} from "../evidence-token";

const KEY = Uint8Array.from(Buffer.from("11".repeat(32), "hex"));
const OTHER_KEY = Uint8Array.from(Buffer.from("22".repeat(32), "hex"));
const NOW_SECONDS = 1_787_899_200;
const NONCE = Uint8Array.from(Buffer.from("33".repeat(32), "hex"));
const POSTGRES_ACTOR_ID = "d3333333-3333-4333-d333-333333333333";
const POSTGRES_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const POSTGRES_PARENT_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const input = {
  audience: "https://app.opsapp.co/api/mcp",
  clientId: "11111111-1111-4111-8111-111111111111",
  grantId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  companyId: "44444444-4444-4444-8444-444444444444",
  parent: {
    kind: "project" as const,
    id: "55555555-5555-4555-8555-555555555555",
  },
  sourceKind: "email_attachment" as const,
  evidenceRef: `ops_evidence:v1:${"a".repeat(64)}`,
  sourceRevisions: [
    { domain: "artifacts" as const, source_revision: 17 },
    { domain: "legacy_operational" as const, source_revision: 29 },
  ] as const,
};

function codec(key = KEY, nowSeconds = NOW_SECONDS) {
  return createMcpEvidenceTokenCodec({
    key,
    now: () => nowSeconds,
    randomBytes: () => NONCE,
  });
}

describe("single-use MCP evidence tokens", () => {
  it("signs every authority, parent, artifact, revision, nonce, and time binding with a dedicated key", () => {
    const issued = codec().issue(input);
    const verified = codec().verify(issued.token);

    expect(verified.claims).toEqual({
      version: 1,
      ...input,
      nonce: Buffer.from(NONCE).toString("base64url"),
      issuedAt: NOW_SECONDS,
      expiresAt: NOW_SECONDS + EVIDENCE_TOKEN_MAX_TTL_SECONDS,
    });
    expect(verified.nonceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(verified.nonceDigest).not.toBe(verified.claims.nonce);
    expect(verified.nonceDigest).toBe(
      "aeee96edde1edbe4cf81859d05e88936b4310f4048ddf0a0b9003dc40e6a4b9c"
    );
    expect(verified.sourceRevisionDigest).toBe(
      createHash("sha256")
        .update("artifacts:17\nlegacy_operational:29", "utf8")
        .digest("hex")
    );
    expect(verified.bindingDigest).toBe(
      "4da93bc2ecf54a8592891fc0623592a79260cc2de62f5ce1c99dd7e381c57d95"
    );
    expect(Object.isFrozen(verified.claims)).toBe(true);
    expect(Object.isFrozen(verified.claims.parent)).toBe(true);
    expect(Object.isFrozen(verified.claims.sourceRevisions)).toBe(true);
  });

  it("round-trips PostgreSQL-shaped non-RFC actor, company, and parent IDs", () => {
    const postgresInput = {
      ...input,
      actorUserId: POSTGRES_ACTOR_ID,
      companyId: POSTGRES_COMPANY_ID,
      parent: { ...input.parent, id: POSTGRES_PARENT_ID },
    };

    const issued = codec().issue(postgresInput);

    expect(codec().verify(issued.token).claims).toMatchObject({
      actorUserId: POSTGRES_ACTOR_ID,
      companyId: POSTGRES_COMPANY_ID,
      parent: { kind: "project", id: POSTGRES_PARENT_ID },
    });
    expect(() =>
      codec().issue({
        ...postgresInput,
        actorUserId: POSTGRES_ACTOR_ID.toUpperCase(),
      })
    ).toThrow(EvidenceTokenError);
    expect(() => codec().verify(`${issued.token}.extra`)).toThrow(
      EvidenceTokenError
    );
  });

  it("keeps OAuth client and grant IDs RFC-strict", () => {
    expect(() =>
      codec().issue({
        ...input,
        clientId: "d1111111-1111-4111-d111-111111111111",
      })
    ).toThrow(EvidenceTokenError);
    expect(() =>
      codec().issue({
        ...input,
        grantId: "00000000-0000-0000-0000-000000000001",
      })
    ).toThrow(EvidenceTokenError);
  });

  it("enforces a five-minute maximum and rejects expired, future, forged, altered, or non-canonical tokens", () => {
    expect(() => codec().issue(input, { ttlSeconds: 301 })).toThrow(
      EvidenceTokenError
    );
    const issued = codec().issue(input);
    expect(() => codec(OTHER_KEY).verify(issued.token)).toThrow(
      EvidenceTokenError
    );
    expect(() => codec().verify(`${issued.token.slice(0, -1)}x`)).toThrow(
      EvidenceTokenError
    );
    expect(() =>
      codec(KEY, NOW_SECONDS + EVIDENCE_TOKEN_MAX_TTL_SECONDS + 1).verify(
        issued.token
      )
    ).toThrow(EvidenceTokenError);

    const [prefix, payload, signature] = issued.token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8")
    );
    const withExtraClaim = Buffer.from(
      JSON.stringify({ ...decoded, storage_path: "private/company/file.pdf" }),
      "utf8"
    ).toString("base64url");
    expect(() =>
      codec().verify(`${prefix}.${withExtraClaim}.${signature}`)
    ).toThrow(EvidenceTokenError);
    expect(() => codec().verify(` ${issued.token}`)).toThrow(
      EvidenceTokenError
    );
  });

  it("never places a bearer, storage locator, filename, URL payload, or bytes in the claim body", () => {
    const token = codec().issue(input).token;
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")
    );
    expect(Object.keys(payload).sort()).toEqual([
      "actor_user_id",
      "aud",
      "client_id",
      "company_id",
      "evidence_ref",
      "exp",
      "grant_id",
      "iat",
      "nonce",
      "parent_id",
      "parent_kind",
      "source_kind",
      "source_revisions",
      "v",
    ]);
    expect(JSON.stringify(payload)).not.toMatch(
      /bearer|token_hash|storage|locator|filename|payload|bytes|private\//i
    );
  });

  it("does not make exposure-v1 startup depend on the evidence key", () => {
    const prior = process.env.OPS_AGENT_MCP_EVIDENCE_SIGNING_KEY;
    delete process.env.OPS_AGENT_MCP_EVIDENCE_SIGNING_KEY;
    expect(mcpEvidenceSigningConfigured()).toBe(false);
    process.env.OPS_AGENT_MCP_EVIDENCE_SIGNING_KEY = "not-a-key";
    expect(mcpEvidenceSigningConfigured()).toBe(false);
    if (prior === undefined) {
      delete process.env.OPS_AGENT_MCP_EVIDENCE_SIGNING_KEY;
    } else {
      process.env.OPS_AGENT_MCP_EVIDENCE_SIGNING_KEY = prior;
    }
  });
});
