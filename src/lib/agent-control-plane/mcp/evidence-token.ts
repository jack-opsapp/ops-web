import "server-only";

import {
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod-v4";

import { ArtifactSourceKindSchema } from "@/lib/agent-control-plane/contracts/job-artifacts";

export const EVIDENCE_TOKEN_MAX_TTL_SECONDS = 5 * 60;
const EVIDENCE_TOKEN_PREFIX = "ops_mcp_ev1" as const;
const EVIDENCE_SIGNING_KEY_ENV = "OPS_AGENT_MCP_EVIDENCE_SIGNING_KEY" as const;
const HEX_32_BYTES_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_32_BYTES_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVIDENCE_REF_PATTERN = /^ops_evidence:v1:[0-9a-f]{64}$/;
const TOKEN_PATTERN =
  /^ops_mcp_ev1\.([A-Za-z0-9_-]{1,4096})\.([A-Za-z0-9_-]{43})$/;
const VERIFIED_EVIDENCE_TOKENS = new WeakSet<object>();

const UuidSchema = z.string().regex(CANONICAL_UUID_PATTERN);
const AudienceSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        ["https:", "http:"].includes(parsed.protocol) &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.hash === "" &&
        value === value.trim()
      );
    } catch {
      return false;
    }
  });
const SourceRevisionsSchema = z.tuple([
  z
    .object({
      domain: z.literal("artifacts"),
      source_revision: z.number().int().safe().nonnegative(),
    })
    .strict(),
  z
    .object({
      domain: z.literal("legacy_operational"),
      source_revision: z.number().int().safe().nonnegative(),
    })
    .strict(),
]);
const WireClaimsSchema = z
  .object({
    v: z.literal(1),
    aud: AudienceSchema,
    client_id: UuidSchema,
    grant_id: UuidSchema,
    actor_user_id: UuidSchema,
    company_id: UuidSchema,
    parent_kind: z.enum(["opportunity", "project"]),
    parent_id: UuidSchema,
    source_kind: ArtifactSourceKindSchema,
    evidence_ref: z.string().regex(EVIDENCE_REF_PATTERN),
    source_revisions: SourceRevisionsSchema,
    nonce: z.string().regex(BASE64URL_32_BYTES_PATTERN),
    iat: z.number().int().safe().nonnegative(),
    exp: z.number().int().safe().positive(),
  })
  .strict();

export interface McpEvidenceTokenClaims {
  readonly version: 1;
  readonly audience: string;
  readonly clientId: string;
  readonly grantId: string;
  readonly actorUserId: string;
  readonly companyId: string;
  readonly parent: Readonly<{
    kind: "opportunity" | "project";
    id: string;
  }>;
  readonly sourceKind: z.infer<typeof ArtifactSourceKindSchema>;
  readonly evidenceRef: string;
  readonly sourceRevisions: readonly [
    Readonly<{ domain: "artifacts"; source_revision: number }>,
    Readonly<{ domain: "legacy_operational"; source_revision: number }>,
  ];
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type McpEvidenceTokenIssueInput = Omit<
  McpEvidenceTokenClaims,
  "version" | "nonce" | "issuedAt" | "expiresAt"
>;

export interface VerifiedMcpEvidenceToken {
  readonly token: string;
  readonly claims: McpEvidenceTokenClaims;
  readonly nonceDigest: string;
  readonly sourceRevisionDigest: string;
  readonly bindingDigest: string;
}

export interface McpEvidenceTokenCodec {
  issue(
    input: McpEvidenceTokenIssueInput,
    options?: Readonly<{ ttlSeconds?: number }>
  ): VerifiedMcpEvidenceToken;
  verify(token: string): VerifiedMcpEvidenceToken;
}

export class EvidenceTokenError extends Error {
  readonly code = "MCP_EVIDENCE_TOKEN_INVALID" as const;

  constructor() {
    super("MCP_EVIDENCE_TOKEN_INVALID");
    this.name = "EvidenceTokenError";
  }
}

function invalid(): never {
  throw new EvidenceTokenError();
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sourceRevisionInput(
  sourceRevisions: McpEvidenceTokenClaims["sourceRevisions"]
): string {
  return `artifacts:${sourceRevisions[0].source_revision}\nlegacy_operational:${sourceRevisions[1].source_revision}`;
}

function digestSourceRevisions(
  sourceRevisions: McpEvidenceTokenClaims["sourceRevisions"]
): string {
  return createHash("sha256")
    .update(sourceRevisionInput(sourceRevisions), "utf8")
    .digest("hex");
}

function digestNonce(key: Uint8Array, nonce: string): string {
  return createHmac("sha256", key)
    .update("ops-mcp-evidence-nonce:v1\0", "utf8")
    .update(nonce, "ascii")
    .digest("hex");
}

/** Shared byte-exact input mirrored by the redemption SQL. */
export function evidenceBindingDigestInput(input: {
  readonly claims: McpEvidenceTokenClaims;
  readonly nonceDigest: string;
}): string {
  const { claims, nonceDigest } = input;
  return [
    "ops-mcp-evidence-binding:v1",
    claims.audience,
    claims.clientId,
    claims.grantId,
    claims.actorUserId,
    claims.companyId,
    claims.parent.kind,
    claims.parent.id,
    claims.sourceKind,
    claims.evidenceRef,
    String(claims.sourceRevisions[0].source_revision),
    String(claims.sourceRevisions[1].source_revision),
    nonceDigest,
    String(claims.issuedAt),
    String(claims.expiresAt),
  ].join("\n");
}

function toPublicClaims(wire: z.infer<typeof WireClaimsSchema>) {
  return deepFreeze<McpEvidenceTokenClaims>({
    version: 1,
    audience: wire.aud,
    clientId: wire.client_id,
    grantId: wire.grant_id,
    actorUserId: wire.actor_user_id,
    companyId: wire.company_id,
    parent: { kind: wire.parent_kind, id: wire.parent_id },
    sourceKind: wire.source_kind,
    evidenceRef: wire.evidence_ref,
    sourceRevisions: [
      { ...wire.source_revisions[0] },
      { ...wire.source_revisions[1] },
    ],
    nonce: wire.nonce,
    issuedAt: wire.iat,
    expiresAt: wire.exp,
  });
}

function resultFor(input: {
  readonly key: Uint8Array;
  readonly token: string;
  readonly wire: z.infer<typeof WireClaimsSchema>;
}): VerifiedMcpEvidenceToken {
  const claims = toPublicClaims(input.wire);
  const nonceDigest = digestNonce(input.key, claims.nonce);
  const result = deepFreeze({
    token: input.token,
    claims,
    nonceDigest,
    sourceRevisionDigest: digestSourceRevisions(claims.sourceRevisions),
    bindingDigest: createHash("sha256")
      .update(evidenceBindingDigestInput({ claims, nonceDigest }), "utf8")
      .digest("hex"),
  });
  VERIFIED_EVIDENCE_TOKENS.add(result);
  return result;
}

export function isVerifiedMcpEvidenceToken(
  value: unknown
): value is VerifiedMcpEvidenceToken {
  return (
    typeof value === "object" &&
    value !== null &&
    VERIFIED_EVIDENCE_TOKENS.has(value)
  );
}

function canonicalPayload(wire: z.infer<typeof WireClaimsSchema>): string {
  return Buffer.from(JSON.stringify(wire), "utf8").toString("base64url");
}

function signature(key: Uint8Array, payload: string): Buffer {
  return createHmac("sha256", key)
    .update(`${EVIDENCE_TOKEN_PREFIX}.${payload}`, "ascii")
    .digest();
}

export function createMcpEvidenceTokenCodec(input: {
  readonly key: Uint8Array;
  readonly now?: () => number;
  readonly randomBytes?: () => Uint8Array;
}): McpEvidenceTokenCodec {
  if (!(input.key instanceof Uint8Array) || input.key.byteLength !== 32) {
    throw new TypeError("A dedicated 32-byte evidence signing key is required");
  }
  const key = Uint8Array.from(input.key);
  const now = input.now ?? (() => Math.floor(Date.now() / 1_000));
  const randomBytes = input.randomBytes ?? (() => nodeRandomBytes(32));

  return Object.freeze({
    issue(
      rawInput: McpEvidenceTokenIssueInput,
      options: Readonly<{ ttlSeconds?: number }> = {}
    ): VerifiedMcpEvidenceToken {
      const issuedAt = now();
      const ttlSeconds = options.ttlSeconds ?? EVIDENCE_TOKEN_MAX_TTL_SECONDS;
      const nonceBytes = randomBytes();
      if (
        !Number.isSafeInteger(issuedAt) ||
        issuedAt < 0 ||
        !Number.isSafeInteger(ttlSeconds) ||
        ttlSeconds < 1 ||
        ttlSeconds > EVIDENCE_TOKEN_MAX_TTL_SECONDS ||
        !(nonceBytes instanceof Uint8Array) ||
        nonceBytes.byteLength !== 32
      ) {
        invalid();
      }
      const candidate = {
        v: 1,
        aud: rawInput.audience,
        client_id: rawInput.clientId,
        grant_id: rawInput.grantId,
        actor_user_id: rawInput.actorUserId,
        company_id: rawInput.companyId,
        parent_kind: rawInput.parent.kind,
        parent_id: rawInput.parent.id,
        source_kind: rawInput.sourceKind,
        evidence_ref: rawInput.evidenceRef,
        source_revisions: rawInput.sourceRevisions,
        nonce: Buffer.from(nonceBytes).toString("base64url"),
        iat: issuedAt,
        exp: issuedAt + ttlSeconds,
      };
      const parsed = WireClaimsSchema.safeParse(candidate);
      if (!parsed.success) invalid();
      const payload = canonicalPayload(parsed.data);
      const token = `${EVIDENCE_TOKEN_PREFIX}.${payload}.${signature(
        key,
        payload
      ).toString("base64url")}`;
      return resultFor({ key, token, wire: parsed.data });
    },

    verify(token: string): VerifiedMcpEvidenceToken {
      if (typeof token !== "string" || token !== token.trim()) invalid();
      const match = TOKEN_PATTERN.exec(token);
      if (!match) invalid();
      const payload = match[1]!;
      const providedSignatureText = match[2]!;
      let providedSignature: Buffer;
      let rawPayload: string;
      try {
        providedSignature = Buffer.from(providedSignatureText, "base64url");
        rawPayload = Buffer.from(payload, "base64url").toString("utf8");
      } catch {
        invalid();
      }
      if (
        providedSignature.byteLength !== 32 ||
        providedSignature.toString("base64url") !== providedSignatureText ||
        !timingSafeEqual(signature(key, payload), providedSignature)
      ) {
        invalid();
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(rawPayload);
      } catch {
        invalid();
      }
      const parsed = WireClaimsSchema.safeParse(decoded);
      if (!parsed.success || canonicalPayload(parsed.data) !== payload) {
        invalid();
      }
      const nowSeconds = now();
      if (
        !Number.isSafeInteger(nowSeconds) ||
        nowSeconds < parsed.data.iat ||
        nowSeconds >= parsed.data.exp ||
        parsed.data.exp - parsed.data.iat < 1 ||
        parsed.data.exp - parsed.data.iat > EVIDENCE_TOKEN_MAX_TTL_SECONDS
      ) {
        invalid();
      }
      return resultFor({ key, token, wire: parsed.data });
    },
  });
}

export function mcpEvidenceSigningConfigured(): boolean {
  return HEX_32_BYTES_PATTERN.test(
    process.env[EVIDENCE_SIGNING_KEY_ENV]?.trim() ?? ""
  );
}

export function createConfiguredMcpEvidenceTokenCodec(): McpEvidenceTokenCodec {
  const rawKey = process.env[EVIDENCE_SIGNING_KEY_ENV]?.trim() ?? "";
  if (!HEX_32_BYTES_PATTERN.test(rawKey)) {
    throw new TypeError("MCP evidence signing key is not provisioned");
  }
  return createMcpEvidenceTokenCodec({
    key: Uint8Array.from(Buffer.from(rawKey, "hex")),
  });
}
