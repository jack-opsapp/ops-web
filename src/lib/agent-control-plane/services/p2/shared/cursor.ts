import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod-v4";

import {
  ContractSlugSchema,
  createP2CanonicalTextSchema,
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  P2_CURSOR_TTL_SECONDS,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import { canonicalOperationalProjection } from "../../operational-read-projection";

const CURSOR_PREFIX = "ops_p2_cursor";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const BINDING_TEXT_SCHEMA = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 512,
  maximumUtf8Bytes: 1_024,
});
const ORDER_TEXT_SCHEMA = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 256,
  maximumUtf8Bytes: 512,
});
const ORDER_VALUE_SCHEMA = z.union([
  ORDER_TEXT_SCHEMA,
  z.number().int().safe(),
  z.boolean(),
]);
const PREDECESSOR_SCHEMA = z
  .object({
    order: z.array(ORDER_VALUE_SCHEMA).min(1).max(8),
    tie_breaker: ORDER_TEXT_SCHEMA,
  })
  .strict();
const CLAIMS_SCHEMA = z
  .object({
    version: z.literal(1),
    key_id: z.string().regex(KEY_ID_PATTERN),
    capability_id: ContractSlugSchema,
    schema_revision: BINDING_TEXT_SCHEMA,
    capability_manifest_revision: BINDING_TEXT_SCHEMA,
    ranking_revision: BINDING_TEXT_SCHEMA,
    actor_user_id: P2CanonicalUuidSchema,
    company_id: P2CanonicalUuidSchema,
    oauth_grant_id: BINDING_TEXT_SCHEMA,
    granted_scope_digest: SHA256_SCHEMA,
    permission_snapshot_revision: BINDING_TEXT_SCHEMA,
    query_hash: SHA256_SCHEMA,
    source_revisions: P2DomainRevisionVectorSchema,
    read_at: P2CanonicalTimestampSchema,
    predecessor: PREDECESSOR_SCHEMA,
    predecessor_order_witness: SHA256_SCHEMA,
    issued_at: z.number().int().safe().nonnegative(),
    expires_at: z.number().int().safe().positive(),
  })
  .strict();

export interface P2ReadCursorExpectation {
  readonly capabilityId: string;
  readonly schemaRevision: string;
  readonly capabilityManifestRevision: string;
  readonly rankingRevision: string;
  readonly actorUserId: string;
  readonly companyId: string;
  readonly oauthGrantId: string;
  readonly grantedScopeDigest: string;
  readonly permissionSnapshotRevision: string;
  readonly queryHash: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly readAt: string;
}

export interface P2ReadCursorPredecessor {
  readonly order: readonly (string | number | boolean)[];
  readonly tie_breaker: string;
}

export type P2ReadCursorClaims = Readonly<z.infer<typeof CLAIMS_SCHEMA>>;

export class P2ReadCursorError extends Error {
  readonly code = "P2_CURSOR_INVALID" as const;

  constructor() {
    super("P2_CURSOR_INVALID");
    this.name = "P2ReadCursorError";
  }
}

function fail(): never {
  throw new P2ReadCursorError();
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonical(value: unknown): string {
  try {
    return canonicalOperationalProjection(
      value as Parameters<typeof canonicalOperationalProjection>[0]
    );
  } catch {
    fail();
  }
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function normalizedNow(value?: number): number {
  const now = value ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(now) || now < 0) fail();
  return now;
}

function expectationProjection(expectation: P2ReadCursorExpectation) {
  return {
    capability_id: expectation.capabilityId,
    schema_revision: expectation.schemaRevision,
    capability_manifest_revision: expectation.capabilityManifestRevision,
    ranking_revision: expectation.rankingRevision,
    actor_user_id: expectation.actorUserId,
    company_id: expectation.companyId,
    oauth_grant_id: expectation.oauthGrantId,
    granted_scope_digest: expectation.grantedScopeDigest,
    permission_snapshot_revision: expectation.permissionSnapshotRevision,
    query_hash: expectation.queryHash,
    source_revisions: expectation.sourceRevisions,
    read_at: expectation.readAt,
  };
}

function decodeBase64Url(segment: string): Buffer {
  if (!BASE64URL_PATTERN.test(segment)) fail();
  const decoded = Buffer.from(segment, "base64url");
  if (!decoded.length || decoded.toString("base64url") !== segment) fail();
  return decoded;
}

export function createP2ReadCursorCodec(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}) {
  if (
    !KEY_ID_PATTERN.test(input.keyId) ||
    !ArrayBuffer.isView(input.key) ||
    input.key.BYTES_PER_ELEMENT !== 1 ||
    input.key.byteLength < 32
  ) {
    throw new TypeError("P2_CURSOR_KEY_INVALID");
  }
  const key = Buffer.from(input.key);

  return Object.freeze({
    encode(
      claims: P2ReadCursorExpectation &
        Readonly<{ predecessor: P2ReadCursorPredecessor }>,
      nowSeconds?: number
    ): string {
      const issuedAt = normalizedNow(nowSeconds);
      const candidate = CLAIMS_SCHEMA.safeParse({
        version: 1,
        key_id: input.keyId,
        ...expectationProjection(claims),
        predecessor: claims.predecessor,
        predecessor_order_witness: sha256(claims.predecessor),
        issued_at: issuedAt,
        expires_at: issuedAt + P2_CURSOR_TTL_SECONDS,
      });
      if (!candidate.success) fail();
      const payload = Buffer.from(canonical(candidate.data), "utf8").toString(
        "base64url"
      );
      const signature = createHmac("sha256", key)
        .update(payload)
        .digest("base64url");
      return `${CURSOR_PREFIX}.${payload}.${signature}`;
    },

    decode(
      token: string,
      expectation: P2ReadCursorExpectation,
      nowSeconds?: number
    ): P2ReadCursorClaims {
      if (typeof token !== "string" || token.length > 8_192) fail();
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX) fail();
      const payload = parts[1]!;
      const suppliedSignature = decodeBase64Url(parts[2]!);
      const expectedSignature = createHmac("sha256", key)
        .update(payload)
        .digest();
      if (
        suppliedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(suppliedSignature, expectedSignature)
      ) {
        fail();
      }

      let raw: unknown;
      try {
        raw = JSON.parse(decodeBase64Url(payload).toString("utf8"));
      } catch {
        fail();
      }
      const parsed = CLAIMS_SCHEMA.safeParse(raw);
      if (!parsed.success || parsed.data.key_id !== input.keyId) fail();
      const now = normalizedNow(nowSeconds);
      if (
        parsed.data.issued_at > now ||
        parsed.data.expires_at <= now ||
        parsed.data.expires_at - parsed.data.issued_at !==
          P2_CURSOR_TTL_SECONDS ||
        parsed.data.predecessor_order_witness !==
          sha256(parsed.data.predecessor) ||
        canonical(expectationProjection(expectation)) !==
          canonical({
            capability_id: parsed.data.capability_id,
            schema_revision: parsed.data.schema_revision,
            capability_manifest_revision:
              parsed.data.capability_manifest_revision,
            ranking_revision: parsed.data.ranking_revision,
            actor_user_id: parsed.data.actor_user_id,
            company_id: parsed.data.company_id,
            oauth_grant_id: parsed.data.oauth_grant_id,
            granted_scope_digest: parsed.data.granted_scope_digest,
            permission_snapshot_revision:
              parsed.data.permission_snapshot_revision,
            query_hash: parsed.data.query_hash,
            source_revisions: parsed.data.source_revisions,
            read_at: parsed.data.read_at,
          })
      ) {
        fail();
      }
      return deepFreeze(parsed.data);
    },
  });
}
