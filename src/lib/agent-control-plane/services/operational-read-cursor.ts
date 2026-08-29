import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod-v4";

import { DiscoveryMillisecondUtcTimestampSchema } from "@/lib/agent-control-plane/contracts/discovery";

const MAX_CURSOR_AGE_SECONDS = 15 * 60;
const CURSOR_PREFIX = "ops_cursor";
export const FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION =
  "2026-08-20.capability-manifest.v7" as const;
const ACTIVE_V8_MANIFEST_REVISION =
  "2026-08-22.capability-manifest.v8" as const;
const UUID_SCHEMA = z.string().uuid();
const DISCOVERY_UUID_SCHEMA = UUID_SCHEMA.refine(
  (value) => value === value.toLowerCase()
);
const UTC_SCHEMA = z.string().datetime({ offset: false });
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

const CommonClaimsSchema = z
  .object({
    version: z.number().int().positive(),
    key_id: z.string().min(1).max(128),
    capability_id: z.enum([
      "list_scheduled_jobs",
      "list_job_readiness_issues",
      "list_customer_jobs",
      "search_job_history",
      "search_customers",
      "search_jobs",
    ]),
    schema_revision: z.string().min(1).max(128),
    capability_manifest_revision: z.string().min(1).max(128),
    rule_revisions: z.array(z.string().min(1).max(128)).max(5),
    actor_user_id: UUID_SCHEMA,
    company_id: UUID_SCHEMA,
    permission_snapshot_revision: z.string().min(1).max(512),
    query_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().positive(),
    source_revision: z.number().int().nonnegative(),
    read_as_of: UTC_SCHEMA,
  })
  .strict();

const ScheduledCursorClaimsSchema = CommonClaimsSchema.extend({
  capability_id: z.literal("list_scheduled_jobs"),
  start_utc: UTC_SCHEMA,
  task_id: UUID_SCHEMA,
}).strict();

const ReadinessCursorClaimsSchema = CommonClaimsSchema.extend({
  capability_id: z.literal("list_job_readiness_issues"),
  first_scheduled_start_utc: UTC_SCHEMA,
  project_id: UUID_SCHEMA,
}).strict();
const CustomerJobsCursorClaimsSchema = CommonClaimsSchema.extend({
  capability_id: z.literal("list_customer_jobs"),
  sort_at: UTC_SCHEMA,
  job_kind: z.enum(["opportunity", "project"]),
  job_id: UUID_SCHEMA,
}).strict();
const JobHistoryCursorClaimsSchema = CommonClaimsSchema.extend({
  capability_id: z.literal("search_job_history"),
  history_revision: z.number().int().nonnegative(),
  rank_micros: z.number().int().safe().min(0).max(1_000_000),
  occurred_at: UTC_SCHEMA,
  source_type: z.enum([
    "delivered_correspondence",
    "current_memory_summary",
    "job_status_event",
    "task_event",
    "estimate_document",
  ]),
  source_id: z.string().min(1).max(512),
}).strict();
const CustomerDiscoveryCursorClaimsSchema = CommonClaimsSchema.extend({
  capability_id: z.literal("search_customers"),
  read_as_of: DiscoveryMillisecondUtcTimestampSchema,
  ranking_revision: z.literal("customer-discovery-ranking:v1"),
  rank_ordinal: z.number().int().min(1).max(500),
  customer_kind: z.enum(["client", "sub_client"]),
  customer_id: DISCOVERY_UUID_SCHEMA,
}).strict();
const JobDiscoveryCursorClaimsSchema = CommonClaimsSchema.extend({
  capability_id: z.literal("search_jobs"),
  read_as_of: DiscoveryMillisecondUtcTimestampSchema,
  ranking_revision: z.literal("job-discovery-ranking:v1"),
  rank_ordinal: z.number().int().min(1).max(500),
  job_kind: z.enum(["opportunity", "project"]),
  job_id: DISCOVERY_UUID_SCHEMA,
}).strict();
const WireSchema = z.discriminatedUnion("c", [
  z
    .object({
      c: z.literal("s"),
      b: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      p: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      i: z.number().int().nonnegative(),
      e: z.number().int().positive(),
      r: z.number().int().nonnegative(),
      t: UTC_SCHEMA,
      x: UUID_SCHEMA,
      a: UTC_SCHEMA,
    })
    .strict(),
  z
    .object({
      c: z.literal("r"),
      b: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      p: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      i: z.number().int().nonnegative(),
      e: z.number().int().positive(),
      r: z.number().int().nonnegative(),
      t: UTC_SCHEMA,
      x: UUID_SCHEMA,
      a: UTC_SCHEMA,
    })
    .strict(),
  z
    .object({
      c: z.literal("c"),
      b: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      p: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      i: z.number().int().nonnegative(),
      e: z.number().int().positive(),
      r: z.number().int().nonnegative(),
      t: UTC_SCHEMA,
      k: z.enum(["opportunity", "project"]),
      x: UUID_SCHEMA,
      a: UTC_SCHEMA,
    })
    .strict(),
  z
    .object({
      c: z.literal("h"),
      b: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      p: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      i: z.number().int().nonnegative(),
      e: z.number().int().positive(),
      r: z.number().int().nonnegative(),
      h: z.number().int().nonnegative(),
      m: z.number().int().safe().min(0).max(1_000_000),
      t: UTC_SCHEMA,
      s: z.enum([
        "delivered_correspondence",
        "current_memory_summary",
        "job_status_event",
        "task_event",
        "estimate_document",
      ]),
      x: z.string().min(1).max(512),
      a: UTC_SCHEMA,
    })
    .strict(),
  z
    .object({
      c: z.literal("u"),
      b: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      p: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      i: z.number().int().nonnegative(),
      e: z.number().int().positive(),
      r: z.number().int().nonnegative(),
      o: z.number().int().min(1).max(500),
      k: z.enum(["client", "sub_client"]),
      x: DISCOVERY_UUID_SCHEMA,
      a: UTC_SCHEMA,
    })
    .strict(),
  z
    .object({
      c: z.literal("j"),
      b: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      p: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      i: z.number().int().nonnegative(),
      e: z.number().int().positive(),
      r: z.number().int().nonnegative(),
      o: z.number().int().min(1).max(500),
      k: z.enum(["opportunity", "project"]),
      x: DISCOVERY_UUID_SCHEMA,
      a: UTC_SCHEMA,
    })
    .strict(),
]);

export type ScheduledJobsCursorClaims = z.infer<
  typeof ScheduledCursorClaimsSchema
>;
export type JobReadinessCursorClaims = z.infer<
  typeof ReadinessCursorClaimsSchema
>;
export type CustomerJobsCursorClaims = z.infer<
  typeof CustomerJobsCursorClaimsSchema
>;
export type JobHistoryCursorClaims = z.infer<
  typeof JobHistoryCursorClaimsSchema
>;
export type CustomerDiscoveryCursorClaims = z.infer<
  typeof CustomerDiscoveryCursorClaimsSchema
>;
export type JobDiscoveryCursorClaims = z.infer<
  typeof JobDiscoveryCursorClaimsSchema
>;
export type OperationalReadCursorClaims =
  | ScheduledJobsCursorClaims
  | JobReadinessCursorClaims
  | CustomerJobsCursorClaims
  | JobHistoryCursorClaims
  | CustomerDiscoveryCursorClaims
  | JobDiscoveryCursorClaims;
type CursorRuntimeFields = "version" | "key_id" | "issued_at" | "expires_at";
type CursorInput<T extends OperationalReadCursorClaims> = T extends unknown
  ? Omit<T, CursorRuntimeFields | "rule_revisions"> &
      Readonly<{ rule_revisions: readonly string[] }>
  : never;
export type OperationalReadCursorInputClaims =
  CursorInput<OperationalReadCursorClaims>;

export class OperationalReadCursorError extends Error {
  constructor() {
    super("OPERATIONAL_READ_CURSOR_INVALID");
    this.name = "OperationalReadCursorError";
  }
}

export class OperationalReadCursorPermissionStaleError extends Error {
  constructor() {
    super("OPERATIONAL_READ_CURSOR_PERMISSION_STALE");
    this.name = "OperationalReadCursorPermissionStaleError";
  }
}

interface CommonOperationalReadCursorExpectation {
  readonly schemaRevision: string;
  readonly capabilityManifestRevision: string;
  readonly ruleRevisions: readonly string[];
  readonly actorUserId: string;
  readonly companyId: string;
  readonly permissionSnapshotRevision: string;
  readonly queryHash: string;
  readonly frozenV7QueryHash?: string;
}

export type OperationalReadCursorExpectation =
  | (CommonOperationalReadCursorExpectation &
      Readonly<{
        capabilityId:
          | "list_scheduled_jobs"
          | "list_job_readiness_issues"
          | "list_customer_jobs"
          | "search_job_history";
      }>)
  | (CommonOperationalReadCursorExpectation &
      Readonly<{
        capabilityId: "search_customers";
        rankingRevision: "customer-discovery-ranking:v1";
      }>)
  | (CommonOperationalReadCursorExpectation &
      Readonly<{
        capabilityId: "search_jobs";
        rankingRevision: "job-discovery-ranking:v1";
      }>);

export interface OperationalReadCursorCodec {
  encode(claims: OperationalReadCursorInputClaims): string;
  decode(input: {
    readonly cursor: string;
    readonly expected: OperationalReadCursorExpectation;
  }): OperationalReadCursorClaims;
}

export interface CreateOperationalReadCursorCodecInput {
  readonly key: Uint8Array;
  readonly keyId: string;
  readonly version: number;
  readonly ttlSeconds?: number;
  readonly now?: () => Date;
}

const TRUSTED_CODECS = new WeakSet<object>();

function base64UrlEncode(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function signedContent(
  version: number,
  keyId: string,
  payload: string
): string {
  return `v${version}:${keyId}:${payload}`;
}

function sign(key: Uint8Array, content: string): Uint8Array {
  return createHmac("sha256", key).update(content).digest();
}

function invalid(): never {
  throw new OperationalReadCursorError();
}

function bindingDigest(
  key: Uint8Array,
  input: {
    readonly capabilityId: string;
    readonly schemaRevision: string;
    readonly capabilityManifestRevision: string;
    readonly rankingRevision?: string;
    readonly ruleRevisions: readonly string[];
    readonly actorUserId: string;
    readonly companyId: string;
    readonly queryHash: string;
  }
): string {
  const binding: unknown[] = [
    input.capabilityId,
    input.schemaRevision,
    input.capabilityManifestRevision,
    input.ruleRevisions,
    input.actorUserId,
    input.companyId,
    input.queryHash,
  ];
  if (input.rankingRevision !== undefined) {
    binding.push(input.rankingRevision);
  }
  return createHmac("sha256", key)
    .update("operational-read-binding\0")
    .update(JSON.stringify(binding))
    .digest("base64url");
}

function permissionDigest(
  key: Uint8Array,
  permissionSnapshotRevision: string
): string {
  return createHmac("sha256", key)
    .update("permission-snapshot\0")
    .update(permissionSnapshotRevision)
    .digest("base64url");
}

function resolveCursorBindingExpectation(input: {
  readonly key: Uint8Array;
  readonly wireBinding: string;
  readonly expected: OperationalReadCursorExpectation;
}): OperationalReadCursorExpectation | null {
  if (input.wireBinding === bindingDigest(input.key, input.expected)) {
    return input.expected;
  }
  if (
    input.expected.capabilityManifestRevision !== ACTIVE_V8_MANIFEST_REVISION ||
    typeof input.expected.frozenV7QueryHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(input.expected.frozenV7QueryHash)
  ) {
    return null;
  }
  const frozenV7Expectation = {
    ...input.expected,
    capabilityManifestRevision: FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
    queryHash: input.expected.frozenV7QueryHash,
  } as OperationalReadCursorExpectation;
  return input.wireBinding === bindingDigest(input.key, frozenV7Expectation)
    ? frozenV7Expectation
    : null;
}

export function hashOperationalReadQuery(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export function createOperationalReadCursorCodec(
  input: CreateOperationalReadCursorCodecInput
): OperationalReadCursorCodec {
  const key = input?.key;
  const keyId = input?.keyId;
  const version = input?.version;
  const ttlSeconds = input?.ttlSeconds ?? MAX_CURSOR_AGE_SECONDS;
  const now = input?.now;
  if (!(key instanceof Uint8Array) || key.byteLength < 32) {
    throw new TypeError(
      "Operational read cursor key must be at least 32 bytes"
    );
  }
  if (typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId)) {
    throw new TypeError("Operational read cursor key ID is required");
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError("Operational read cursor version is invalid");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
    throw new TypeError("Operational read cursor TTL is invalid");
  }
  if (now !== undefined && typeof now !== "function") {
    throw new TypeError("Operational read cursor clock must be a function");
  }
  const capturedKey = new Uint8Array(key);
  const capturedKeyId = keyId.trim();
  const capturedVersion = version;
  const capturedTtl = ttlSeconds;
  const capturedNow = now;

  const codec = {
    encode(rawClaims: OperationalReadCursorInputClaims): string {
      const issuedAt = Math.floor(
        (capturedNow?.() ?? new Date()).getTime() / 1000
      );
      const claims = {
        ...rawClaims,
        version: capturedVersion,
        key_id: capturedKeyId,
        issued_at: issuedAt,
        expires_at: issuedAt + capturedTtl,
      };
      const parsed = (() => {
        switch (claims.capability_id) {
          case "list_scheduled_jobs":
            return ScheduledCursorClaimsSchema.safeParse(claims);
          case "list_job_readiness_issues":
            return ReadinessCursorClaimsSchema.safeParse(claims);
          case "list_customer_jobs":
            return CustomerJobsCursorClaimsSchema.safeParse(claims);
          case "search_job_history":
            return JobHistoryCursorClaimsSchema.safeParse(claims);
          case "search_customers":
            return CustomerDiscoveryCursorClaimsSchema.safeParse(claims);
          case "search_jobs":
            return JobDiscoveryCursorClaimsSchema.safeParse(claims);
          default:
            return { success: false as const };
        }
      })();
      if (!parsed.success) invalid();
      const binding = bindingDigest(capturedKey, {
        capabilityId: parsed.data.capability_id,
        schemaRevision: parsed.data.schema_revision,
        capabilityManifestRevision: parsed.data.capability_manifest_revision,
        rankingRevision:
          parsed.data.capability_id === "search_customers" ||
          parsed.data.capability_id === "search_jobs"
            ? parsed.data.ranking_revision
            : undefined,
        ruleRevisions: parsed.data.rule_revisions,
        actorUserId: parsed.data.actor_user_id,
        companyId: parsed.data.company_id,
        queryHash: parsed.data.query_hash,
      });
      const wire = (() => {
        switch (parsed.data.capability_id) {
          case "list_scheduled_jobs":
            return {
              c: "s" as const,
              b: binding,
              p: permissionDigest(
                capturedKey,
                parsed.data.permission_snapshot_revision
              ),
              i: parsed.data.issued_at,
              e: parsed.data.expires_at,
              r: parsed.data.source_revision,
              t: parsed.data.start_utc,
              x: parsed.data.task_id,
              a: parsed.data.read_as_of,
            };
          case "list_job_readiness_issues":
            return {
              c: "r" as const,
              b: binding,
              p: permissionDigest(
                capturedKey,
                parsed.data.permission_snapshot_revision
              ),
              i: parsed.data.issued_at,
              e: parsed.data.expires_at,
              r: parsed.data.source_revision,
              t: parsed.data.first_scheduled_start_utc,
              x: parsed.data.project_id,
              a: parsed.data.read_as_of,
            };
          case "list_customer_jobs":
            return {
              c: "c" as const,
              b: binding,
              p: permissionDigest(
                capturedKey,
                parsed.data.permission_snapshot_revision
              ),
              i: parsed.data.issued_at,
              e: parsed.data.expires_at,
              r: parsed.data.source_revision,
              t: parsed.data.sort_at,
              k: parsed.data.job_kind,
              x: parsed.data.job_id,
              a: parsed.data.read_as_of,
            };
          case "search_job_history":
            return {
              c: "h" as const,
              b: binding,
              p: permissionDigest(
                capturedKey,
                parsed.data.permission_snapshot_revision
              ),
              i: parsed.data.issued_at,
              e: parsed.data.expires_at,
              r: parsed.data.source_revision,
              h: parsed.data.history_revision,
              m: parsed.data.rank_micros,
              t: parsed.data.occurred_at,
              s: parsed.data.source_type,
              x: parsed.data.source_id,
              a: parsed.data.read_as_of,
            };
          case "search_customers":
            return {
              c: "u" as const,
              b: binding,
              p: permissionDigest(
                capturedKey,
                parsed.data.permission_snapshot_revision
              ),
              i: parsed.data.issued_at,
              e: parsed.data.expires_at,
              r: parsed.data.source_revision,
              o: parsed.data.rank_ordinal,
              k: parsed.data.customer_kind,
              x: parsed.data.customer_id,
              a: parsed.data.read_as_of,
            };
          case "search_jobs":
            return {
              c: "j" as const,
              b: binding,
              p: permissionDigest(
                capturedKey,
                parsed.data.permission_snapshot_revision
              ),
              i: parsed.data.issued_at,
              e: parsed.data.expires_at,
              r: parsed.data.source_revision,
              o: parsed.data.rank_ordinal,
              k: parsed.data.job_kind,
              x: parsed.data.job_id,
              a: parsed.data.read_as_of,
            };
        }
      })();
      const payload = base64UrlEncode(JSON.stringify(wire));
      const signature = base64UrlEncode(
        sign(
          capturedKey,
          signedContent(capturedVersion, capturedKeyId, payload)
        )
      );
      const cursor = `${CURSOR_PREFIX}:v${capturedVersion}:${capturedKeyId}:${payload}.${signature}`;
      if (cursor.length > 512) invalid();
      return cursor;
    },
    decode({
      cursor,
      expected,
    }: Parameters<
      OperationalReadCursorCodec["decode"]
    >[0]): OperationalReadCursorClaims {
      if (typeof cursor !== "string" || cursor.length > 512) invalid();
      const match =
        /^ops_cursor:v([1-9][0-9]*):([A-Za-z0-9_-]{1,32}):([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(
          cursor
        );
      if (!match) invalid();
      const [, cursorVersion, cursorKeyId, payload, signature] = match;
      if (
        Number(cursorVersion) !== capturedVersion ||
        cursorKeyId !== capturedKeyId
      ) {
        invalid();
      }
      let actualSignature: Uint8Array;
      try {
        actualSignature = Buffer.from(signature!, "base64url");
        if (base64UrlEncode(actualSignature) !== signature) invalid();
      } catch {
        invalid();
      }
      const expectedSignature = sign(
        capturedKey,
        signedContent(capturedVersion, capturedKeyId, payload!)
      );
      if (
        actualSignature.byteLength !== expectedSignature.byteLength ||
        !timingSafeEqual(actualSignature, expectedSignature)
      ) {
        invalid();
      }
      let decoded: unknown;
      try {
        const payloadBytes = Buffer.from(payload!, "base64url");
        if (base64UrlEncode(payloadBytes) !== payload) invalid();
        decoded = JSON.parse(payloadBytes.toString());
      } catch {
        invalid();
      }
      const parsed = WireSchema.safeParse(decoded);
      if (!parsed.success) invalid();
      const wire = parsed.data;
      const nowSeconds = Math.floor(
        (capturedNow?.() ?? new Date()).getTime() / 1000
      );
      const expectedWireKind = (() => {
        switch (expected.capabilityId) {
          case "list_scheduled_jobs":
            return "s";
          case "list_job_readiness_issues":
            return "r";
          case "list_customer_jobs":
            return "c";
          case "search_job_history":
            return "h";
          case "search_customers":
            return "u";
          case "search_jobs":
            return "j";
        }
      })();
      const bindingExpectation = resolveCursorBindingExpectation({
        key: capturedKey,
        wireBinding: wire.b,
        expected,
      });
      if (
        wire.c !== expectedWireKind ||
        bindingExpectation === null ||
        wire.i > nowSeconds + 60 ||
        wire.e <= nowSeconds ||
        wire.e - wire.i > capturedTtl
      ) {
        invalid();
      }
      if (
        wire.p !==
        permissionDigest(capturedKey, expected.permissionSnapshotRevision)
      ) {
        throw new OperationalReadCursorPermissionStaleError();
      }
      const common = {
        version: capturedVersion,
        key_id: capturedKeyId,
        capability_id: bindingExpectation.capabilityId,
        schema_revision: bindingExpectation.schemaRevision,
        capability_manifest_revision:
          bindingExpectation.capabilityManifestRevision,
        rule_revisions: [...bindingExpectation.ruleRevisions],
        actor_user_id: bindingExpectation.actorUserId,
        company_id: bindingExpectation.companyId,
        permission_snapshot_revision: expected.permissionSnapshotRevision,
        query_hash: bindingExpectation.queryHash,
        issued_at: wire.i,
        expires_at: wire.e,
        source_revision: wire.r,
        read_as_of: wire.a,
      };
      const claims = (() => {
        switch (wire.c) {
          case "s":
            return {
              ...common,
              capability_id: "list_scheduled_jobs" as const,
              start_utc: wire.t,
              task_id: wire.x,
            };
          case "r":
            return {
              ...common,
              capability_id: "list_job_readiness_issues" as const,
              first_scheduled_start_utc: wire.t,
              project_id: wire.x,
            };
          case "c":
            return {
              ...common,
              capability_id: "list_customer_jobs" as const,
              sort_at: wire.t,
              job_kind: wire.k,
              job_id: wire.x,
            };
          case "h":
            return {
              ...common,
              capability_id: "search_job_history" as const,
              history_revision: wire.h,
              rank_micros: wire.m,
              occurred_at: wire.t,
              source_type: wire.s,
              source_id: wire.x,
            };
          case "u":
            return {
              ...common,
              capability_id: "search_customers" as const,
              ranking_revision: "customer-discovery-ranking:v1" as const,
              rank_ordinal: wire.o,
              customer_kind: wire.k,
              customer_id: wire.x,
            };
          case "j":
            return {
              ...common,
              capability_id: "search_jobs" as const,
              ranking_revision: "job-discovery-ranking:v1" as const,
              rank_ordinal: wire.o,
              job_kind: wire.k,
              job_id: wire.x,
            };
        }
      })();
      return Object.freeze(claims);
    },
  };
  TRUSTED_CODECS.add(codec);
  return Object.freeze(codec);
}

export function isTrustedOperationalReadCursorCodec(
  value: unknown
): value is OperationalReadCursorCodec {
  return (
    typeof value === "object" && value !== null && TRUSTED_CODECS.has(value)
  );
}
