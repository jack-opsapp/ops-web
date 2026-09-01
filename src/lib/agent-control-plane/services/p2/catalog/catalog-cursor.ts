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
import type { AuthorizedSearchCatalogItemsRead } from "./catalog-authorization";

export const CATALOG_RANKING_REVISION =
  "catalog-ranking:2026-08-22.v1" as const;

export const CatalogCursorPredecessorSchema = z
  .object({
    order: z.tuple([P2CanonicalTimestampSchema, P2CanonicalUuidSchema]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[1] === predecessor.tie_breaker,
    "CATALOG_CURSOR_PREDECESSOR_INVALID"
  );

const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: P2DomainRevisionVectorSchema,
  })
  .passthrough()
  .refine(
    (hint) =>
      hint.source_revisions.length === 1 &&
      hint.source_revisions[0]?.domain === "catalog",
    "CATALOG_CURSOR_REVISION_VECTOR_INVALID"
  );

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

function scopeDigest(authorization: AuthorizedSearchCatalogItemsRead) {
  return digest({
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    scope_ceiling: authorization.grantedScopeCeiling,
    authorization_candidates: authorization.authorizationCandidates,
  });
}

function queryHash(authorization: AuthorizedSearchCatalogItemsRead) {
  return digest({
    query: authorization.query.query ?? null,
    active_state: authorization.query.active_state,
    stock_states: authorization.query.stock_states,
    low_stock_only: authorization.query.low_stock_only,
    category_ref: authorization.query.category_ref ?? null,
    limit: authorization.query.limit,
  });
}

function expectation(
  authorization: AuthorizedSearchCatalogItemsRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: CATALOG_RANKING_REVISION,
    actorUserId: authorization.actorContext.actorUserId,
    companyId: authorization.actorContext.companyId,
    oauthGrantId: authorization.oauthGrantId,
    grantedScopeDigest: scopeDigest(authorization),
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

export interface CatalogCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly predecessor: P2ReadCursorPredecessor;
}

export interface CatalogCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedSearchCatalogItemsRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: P2ReadCursorPredecessor;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedSearchCatalogItemsRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): CatalogCursorContext;
}

export function createCatalogCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): CatalogCursorService {
  const codec = createP2ReadCursorCodec(input);
  return Object.freeze({
    encode(
      value: {
        readonly authorization: AuthorizedSearchCatalogItemsRead;
        readonly sourceRevisions: readonly P2DomainRevision[];
        readonly readAt: string;
        readonly predecessor: P2ReadCursorPredecessor;
      },
      nowSeconds?: number
    ) {
      const predecessor = CatalogCursorPredecessorSchema.safeParse(
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
        readonly authorization: AuthorizedSearchCatalogItemsRead;
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
      const predecessor = CatalogCursorPredecessorSchema.safeParse(
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

export function catalogQueryHash(
  authorization: AuthorizedSearchCatalogItemsRead
) {
  return queryHash(authorization);
}

export function catalogScopeDigest(
  authorization: AuthorizedSearchCatalogItemsRead
) {
  return scopeDigest(authorization);
}
