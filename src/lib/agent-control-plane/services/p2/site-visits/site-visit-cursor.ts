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
import type { AuthorizedListSiteVisitsRead } from "./site-visit-authorization";

export const SITE_VISIT_LIST_RANKING_REVISION =
  "site-visit-ranking:2026-08-22.v1" as const;

export const SiteVisitListCursorPredecessorSchema = z
  .object({
    view: z.enum(["booked_appointments", "visit_history"]),
    order: z.tuple([P2CanonicalTimestampSchema, P2CanonicalUuidSchema]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[1] === predecessor.tie_breaker,
    "SITE_VISIT_CURSOR_PREDECESSOR_INVALID"
  );

const ExactSiteVisitRevisionVectorSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    revisions.length === 1 && revisions[0]?.domain === "site_visits",
  "SITE_VISIT_CURSOR_REVISION_VECTOR_INVALID"
);
const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactSiteVisitRevisionVectorSchema,
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
      .update(
        canonicalOperationalProjection(
          value as Parameters<typeof canonicalOperationalProjection>[0]
        )
      )
      .digest("hex")}`;
  } catch {
    throw new P2ReadCursorError();
  }
}

function scopeDigest(authorization: AuthorizedListSiteVisitsRead) {
  return digest({ scope_ceiling: authorization.grantedScopeCeiling });
}

function queryHash(authorization: AuthorizedListSiteVisitsRead) {
  const query = authorization.query;
  return digest(
    query.view === "booked_appointments"
      ? {
          view: query.view,
          from: query.from,
          to: query.to,
          statuses: query.statuses,
          assignee_ref: query.assignee_ref ?? null,
          opportunity_ref: query.opportunity_ref ?? null,
          limit: query.limit,
        }
      : {
          view: query.view,
          created_from: query.created_from,
          created_to: query.created_to,
          statuses: query.statuses ?? [],
          include_unlinked: query.include_unlinked,
          assignee_ref: query.assignee_ref ?? null,
          opportunity_ref: query.opportunity_ref ?? null,
          limit: query.limit,
        }
  );
}

function expectation(
  authorization: AuthorizedListSiteVisitsRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: SITE_VISIT_LIST_RANKING_REVISION,
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

export interface SiteVisitListCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly Readonly<{
    domain: "site_visits";
    source_revision: number;
  }>[];
  readonly predecessor: z.infer<typeof SiteVisitListCursorPredecessorSchema>;
}

export interface SiteVisitListCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedListSiteVisitsRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: z.infer<
        typeof SiteVisitListCursorPredecessorSchema
      >;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedListSiteVisitsRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): SiteVisitListCursorContext;
}

export function createSiteVisitListCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): SiteVisitListCursorService {
  const codec = createP2ReadCursorCodec(input);
  return Object.freeze({
    encode(
      value: {
        readonly authorization: AuthorizedListSiteVisitsRead;
        readonly sourceRevisions: readonly P2DomainRevision[];
        readonly readAt: string;
        readonly predecessor: z.infer<
          typeof SiteVisitListCursorPredecessorSchema
        >;
      },
      nowSeconds?: number
    ) {
      const revisions = ExactSiteVisitRevisionVectorSchema.safeParse(
        value.sourceRevisions
      );
      const predecessor = SiteVisitListCursorPredecessorSchema.safeParse(
        value.predecessor
      );
      if (
        !revisions.success ||
        !predecessor.success ||
        predecessor.data.view !== value.authorization.query.view
      ) {
        throw new P2ReadCursorError();
      }
      return codec.encode(
        {
          ...expectation(value.authorization, revisions.data, value.readAt),
          predecessor: {
            order: predecessor.data.order,
            tie_breaker: predecessor.data.tie_breaker,
          },
        },
        nowSeconds
      );
    },
    decode(
      value: {
        readonly authorization: AuthorizedListSiteVisitsRead;
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
      const revisions = ExactSiteVisitRevisionVectorSchema.safeParse(
        claims.source_revisions
      );
      const predecessor = SiteVisitListCursorPredecessorSchema.safeParse({
        ...claims.predecessor,
        view: value.authorization.query.view,
      });
      if (
        !revisions.success ||
        !predecessor.success ||
        predecessor.data.view !== value.authorization.query.view
      ) {
        throw new P2ReadCursorError();
      }
      const context: SiteVisitListCursorContext = {
        readAt: claims.read_at,
        sourceRevisions: revisions.data.map((revision) => ({
          domain: "site_visits" as const,
          source_revision: revision.source_revision,
        })),
        predecessor: {
          view: predecessor.data.view,
          order: [predecessor.data.order[0], predecessor.data.order[1]],
          tie_breaker: predecessor.data.tie_breaker,
        },
      };
      return deepFreeze(context);
    },
  });
}

export function siteVisitListQueryHash(
  authorization: AuthorizedListSiteVisitsRead
) {
  return queryHash(authorization);
}

export function siteVisitGrantedScopeDigest(
  authorization: AuthorizedListSiteVisitsRead
) {
  return scopeDigest(authorization);
}
