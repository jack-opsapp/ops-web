import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod-v4";

import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import { createP2ReadCursorCodec, P2ReadCursorError } from "../shared/cursor";
import type { AuthorizedListPaymentsRead } from "./payment-authorization";

export const PAYMENT_RANKING_REVISION =
  "payment-ranking:2026-08-22.v1" as const;

const CanonicalDateSchema = z
  .string()
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = `${value}T00:00:00.000Z`;
    const instant = new Date(timestamp);
    return (
      !Number.isNaN(instant.getTime()) && instant.toISOString() === timestamp
    );
  });

export const PaymentCursorPredecessorSchema = z
  .object({
    order: z.tuple([CanonicalDateSchema, P2CanonicalUuidSchema]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[1] === predecessor.tie_breaker,
    "PAYMENT_CURSOR_PREDECESSOR_INVALID"
  );

const ExactPaymentRevisionVectorSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    revisions.length === 3 &&
    revisions[0]?.domain === "legacy_operational" &&
    revisions[1]?.domain === "payments" &&
    revisions[2]?.domain === "sales_documents",
  "PAYMENT_CURSOR_REVISION_VECTOR_INVALID"
);
const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactPaymentRevisionVectorSchema,
  })
  .passthrough();

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function digest(value: unknown): string {
  try {
    return `sha256:${createHash("sha256")
      .update(canonicalOperationalProjection(value as never), "utf8")
      .digest("hex")}`;
  } catch {
    throw new P2ReadCursorError();
  }
}

function queryHash(authorization: AuthorizedListPaymentsRead) {
  const query = authorization.query;
  return digest({
    invoice_ref: query.invoice_ref ?? null,
    customer_ref: query.customer_ref ?? null,
    job_ref: query.job_ref ?? null,
    payment_date_window: query.payment_date_window ?? null,
    method_categories: query.method_categories,
    reconciliation_states: query.reconciliation_states,
    limit: query.limit,
  });
}

function authorityDigest(authorization: AuthorizedListPaymentsRead) {
  return digest({
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    authorization_candidate: authorization.authorizationCandidate,
  });
}

function expectation(
  authorization: AuthorizedListPaymentsRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: PAYMENT_RANKING_REVISION,
    actorUserId: authorization.actorContext.actorUserId,
    companyId: authorization.actorContext.companyId,
    oauthGrantId: authorization.oauthGrantId,
    grantedScopeDigest: authorityDigest(authorization),
    permissionSnapshotRevision:
      authorization.actorContext.permissionSnapshotRevision,
    queryHash: queryHash(authorization),
    sourceRevisions,
    readAt,
  } as const;
}

function decodeHint(token: string) {
  try {
    if (typeof token !== "string" || token.length > 8_192) {
      throw new P2ReadCursorError();
    }
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "ops_p2_cursor") {
      throw new P2ReadCursorError();
    }
    const payload = parts[1]!;
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new P2ReadCursorError();
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.toString("base64url") !== payload) {
      throw new P2ReadCursorError();
    }
    return CursorHintSchema.parse(JSON.parse(decoded.toString("utf8")));
  } catch (error) {
    if (error instanceof P2ReadCursorError) throw error;
    throw new P2ReadCursorError();
  }
}

export interface PaymentCursorPredecessor {
  readonly order: readonly [string, string];
  readonly tie_breaker: string;
}

export interface PaymentCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly predecessor: PaymentCursorPredecessor;
}

export interface PaymentCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedListPaymentsRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: PaymentCursorPredecessor;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedListPaymentsRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): PaymentCursorContext;
}

export function createPaymentCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): PaymentCursorService {
  const codec = createP2ReadCursorCodec(input);
  const service: PaymentCursorService = {
    encode(value, nowSeconds?: number) {
      const revisions = ExactPaymentRevisionVectorSchema.safeParse(
        value.sourceRevisions
      );
      const predecessor = PaymentCursorPredecessorSchema.safeParse(
        value.predecessor
      );
      if (!revisions.success || !predecessor.success) {
        throw new P2ReadCursorError();
      }
      return codec.encode(
        {
          ...expectation(value.authorization, revisions.data, value.readAt),
          predecessor: predecessor.data,
        },
        nowSeconds
      );
    },
    decode(value, nowSeconds?: number) {
      const hint = decodeHint(value.token);
      const claims = codec.decode(
        value.token,
        expectation(value.authorization, hint.source_revisions, hint.read_at),
        nowSeconds
      );
      const revisions = ExactPaymentRevisionVectorSchema.safeParse(
        claims.source_revisions
      );
      const predecessor = PaymentCursorPredecessorSchema.safeParse(
        claims.predecessor
      );
      if (!revisions.success || !predecessor.success) {
        throw new P2ReadCursorError();
      }
      return deepFreeze({
        readAt: claims.read_at,
        sourceRevisions: revisions.data.map((revision) => ({ ...revision })),
        predecessor: {
          order: [
            predecessor.data.order[0],
            predecessor.data.order[1],
          ] as const,
          tie_breaker: predecessor.data.tie_breaker,
        },
      });
    },
  };
  return Object.freeze(service);
}

export function paymentListQueryHash(
  authorization: AuthorizedListPaymentsRead
) {
  return queryHash(authorization);
}
