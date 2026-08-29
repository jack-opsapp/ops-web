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
import {
  createP2ReadCursorCodec,
  P2ReadCursorError,
  type P2ReadCursorPredecessor,
} from "../shared/cursor";
import type { AuthorizedListPurchaseOrdersRead } from "./purchase-order-authorization";

export const PURCHASE_ORDER_RANKING_REVISION =
  "purchase-order-ranking:2026-08-22.v1" as const;

const CanonicalDateSchema = z
  .string()
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const instant = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(instant.getTime()) &&
      instant.toISOString() === `${value}T00:00:00.000Z`
    );
  }, "PURCHASE_ORDER_CURSOR_DATE_INVALID");

export const PurchaseOrderCursorPredecessorSchema = z
  .object({
    order: z.tuple([
      CanonicalDateSchema,
      P2CanonicalTimestampSchema,
      P2CanonicalUuidSchema,
    ]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[2] === predecessor.tie_breaker,
    "PURCHASE_ORDER_CURSOR_PREDECESSOR_INVALID"
  );

const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: P2DomainRevisionVectorSchema,
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

function scopeDigest(authorization: AuthorizedListPurchaseOrdersRead) {
  return digest({
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    scope_ceiling: authorization.grantedScopeCeiling,
    authorization_candidates: authorization.authorizationCandidates,
  });
}

function queryHash(authorization: AuthorizedListPurchaseOrdersRead) {
  return digest({
    statuses: authorization.query.statuses,
    supplier: authorization.query.supplier ?? null,
    delivery_window: authorization.query.delivery_window ?? null,
    sections: authorization.query.sections,
    limit: authorization.query.limit,
  });
}

function exactRevisionVector(
  authorization: AuthorizedListPurchaseOrdersRead,
  revisions: readonly P2DomainRevision[]
) {
  const costs = authorization.query.sections.includes("costs");
  const valid = costs
    ? revisions.length === 2 &&
      revisions[0]?.domain === "catalog" &&
      revisions[1]?.domain === "purchasing"
    : revisions.length === 1 && revisions[0]?.domain === "purchasing";
  if (!valid) throw new P2ReadCursorError();
  return revisions;
}

function expectation(
  authorization: AuthorizedListPurchaseOrdersRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: PURCHASE_ORDER_RANKING_REVISION,
    actorUserId: authorization.actorContext.actorUserId,
    companyId: authorization.actorContext.companyId,
    oauthGrantId: authorization.oauthGrantId,
    grantedScopeDigest: scopeDigest(authorization),
    permissionSnapshotRevision:
      authorization.actorContext.permissionSnapshotRevision,
    queryHash: queryHash(authorization),
    sourceRevisions: exactRevisionVector(authorization, sourceRevisions),
    readAt,
  } as const;
}

function decodeHint(token: string) {
  try {
    if (typeof token !== "string" || token.length > 8_192) {
      throw new P2ReadCursorError();
    }
    const parts = token.split(".");
    if (parts.length !== 3) throw new P2ReadCursorError();
    const payload = parts[1];
    if (!payload) throw new P2ReadCursorError();
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

export interface PurchaseOrderCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly predecessor: P2ReadCursorPredecessor;
}

export interface PurchaseOrderCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedListPurchaseOrdersRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: P2ReadCursorPredecessor;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedListPurchaseOrdersRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): PurchaseOrderCursorContext;
}

export function createPurchaseOrderCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): PurchaseOrderCursorService {
  const codec = createP2ReadCursorCodec(input);
  return Object.freeze({
    encode(
      value: {
        readonly authorization: AuthorizedListPurchaseOrdersRead;
        readonly sourceRevisions: readonly P2DomainRevision[];
        readonly readAt: string;
        readonly predecessor: P2ReadCursorPredecessor;
      },
      nowSeconds?: number
    ) {
      const predecessor = PurchaseOrderCursorPredecessorSchema.safeParse(
        value.predecessor
      );
      if (!predecessor.success) throw new P2ReadCursorError();
      return codec.encode(
        {
          ...expectation(
            value.authorization,
            value.sourceRevisions,
            value.readAt
          ),
          predecessor: predecessor.data,
        },
        nowSeconds
      );
    },
    decode(
      value: {
        readonly authorization: AuthorizedListPurchaseOrdersRead;
        readonly token: string;
      },
      nowSeconds?: number
    ) {
      const hint = decodeHint(value.token);
      const claims = codec.decode(
        value.token,
        expectation(value.authorization, hint.source_revisions, hint.read_at),
        nowSeconds
      );
      const predecessor = PurchaseOrderCursorPredecessorSchema.safeParse(
        claims.predecessor
      );
      if (!predecessor.success) throw new P2ReadCursorError();
      return deepFreeze({
        readAt: claims.read_at,
        sourceRevisions: claims.source_revisions.map((revision) => ({
          ...revision,
        })),
        predecessor: {
          order: [...predecessor.data.order],
          tie_breaker: predecessor.data.tie_breaker,
        },
      });
    },
  });
}

export function purchaseOrderQueryHash(
  authorization: AuthorizedListPurchaseOrdersRead
) {
  return queryHash(authorization);
}

export function purchaseOrderScopeDigest(
  authorization: AuthorizedListPurchaseOrdersRead
) {
  return scopeDigest(authorization);
}
