import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod-v4";

import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import {
  SalesDocumentKindSchema,
  type SalesDocumentKind,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import { createP2ReadCursorCodec, P2ReadCursorError } from "../shared/cursor";
import type { AuthorizedListSalesDocumentsRead } from "./sales-authorization";

export const SALES_DOCUMENT_RANKING_REVISION =
  "sales-document-ranking:2026-08-22.v1" as const;

export const SalesDocumentCursorPredecessorSchema = z
  .object({
    order: z.tuple([
      P2CanonicalTimestampSchema,
      SalesDocumentKindSchema,
      P2CanonicalUuidSchema,
    ]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[2] === predecessor.tie_breaker,
    "SALES_DOCUMENT_CURSOR_PREDECESSOR_INVALID"
  );

export interface SalesDocumentCursorPredecessor {
  readonly order: readonly [string, SalesDocumentKind, string];
  readonly tie_breaker: string;
}

const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: P2DomainRevisionVectorSchema,
  })
  .passthrough()
  .refine(
    (hint) =>
      hint.source_revisions.length === 2 &&
      hint.source_revisions[0]?.domain === "legacy_operational" &&
      hint.source_revisions[1]?.domain === "sales_documents",
    "SALES_DOCUMENT_CURSOR_REVISION_VECTOR_INVALID"
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

function scopeDigest(authorization: AuthorizedListSalesDocumentsRead) {
  return digest({
    scope_ceiling: authorization.grantedScopeCeiling,
    authorization_candidates: authorization.authorizationCandidates,
  });
}

function queryHash(authorization: AuthorizedListSalesDocumentsRead) {
  return digest({
    document_kinds: authorization.query.document_kinds,
    customer_ref: authorization.query.customer_ref ?? null,
    job_ref: authorization.query.job_ref ?? null,
    limit: authorization.query.limit,
  });
}

function expectation(
  authorization: AuthorizedListSalesDocumentsRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: SALES_DOCUMENT_RANKING_REVISION,
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

export interface SalesDocumentCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly predecessor: SalesDocumentCursorPredecessor;
}

export interface SalesDocumentCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedListSalesDocumentsRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: SalesDocumentCursorPredecessor;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedListSalesDocumentsRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): SalesDocumentCursorContext;
}

export function createSalesDocumentCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): SalesDocumentCursorService {
  const codec = createP2ReadCursorCodec(input);
  return Object.freeze({
    encode(
      value: {
        readonly authorization: AuthorizedListSalesDocumentsRead;
        readonly sourceRevisions: readonly P2DomainRevision[];
        readonly readAt: string;
        readonly predecessor: SalesDocumentCursorPredecessor;
      },
      nowSeconds?: number
    ) {
      const predecessor = SalesDocumentCursorPredecessorSchema.safeParse(
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
        readonly authorization: AuthorizedListSalesDocumentsRead;
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
      const predecessor = SalesDocumentCursorPredecessorSchema.safeParse(
        claims.predecessor
      );
      if (!predecessor.success) throw new P2ReadCursorError();
      return deepFreeze({
        readAt: claims.read_at,
        sourceRevisions: claims.source_revisions.map((revision) => ({
          ...revision,
        })),
        predecessor: {
          order: predecessor.data.order,
          tie_breaker: predecessor.data.tie_breaker,
        },
      });
    },
  });
}

export function salesDocumentQueryHash(
  authorization: AuthorizedListSalesDocumentsRead
) {
  return queryHash(authorization);
}

export function salesDocumentScopeDigest(
  authorization: AuthorizedListSalesDocumentsRead
) {
  return scopeDigest(authorization);
}
