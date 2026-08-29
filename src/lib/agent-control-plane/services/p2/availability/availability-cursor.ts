import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod-v4";

import {
  createP2CanonicalTextSchema,
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import { createP2ReadCursorCodec, P2ReadCursorError } from "../shared/cursor";
import type { AuthorizedTeamAvailabilityRead } from "./availability-authorization";

export const TEAM_AVAILABILITY_RANKING_REVISION =
  "availability-member-order:2026-08-22.v1" as const;

const DisplayNameSchema = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 256,
  maximumUtf8Bytes: 1_024,
});

export const TeamAvailabilityCursorPredecessorSchema = z
  .object({
    order: z.tuple([DisplayNameSchema, P2CanonicalUuidSchema]),
    tie_breaker: P2CanonicalUuidSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[1] === predecessor.tie_breaker,
    "TEAM_AVAILABILITY_CURSOR_PREDECESSOR_INVALID"
  );

export interface TeamAvailabilityCursorPredecessor {
  readonly order: readonly [string, string];
  readonly tie_breaker: string;
}

const ExactSourceRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    revisions.length === 4 &&
    revisions[0]?.domain === "availability" &&
    revisions[1]?.domain === "site_visits" &&
    revisions[2]?.domain === "tasks" &&
    revisions[3]?.domain === "team",
  "TEAM_AVAILABILITY_CURSOR_REVISION_VECTOR_INVALID"
);

const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactSourceRevisionsSchema,
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

function assertCompanyCursor(authorization: AuthorizedTeamAvailabilityRead) {
  if (authorization.availabilityScope !== "company") {
    throw new P2ReadCursorError();
  }
}

function authorityDigest(authorization: AuthorizedTeamAvailabilityRead) {
  assertCompanyCursor(authorization);
  return digest({
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    scope_ceiling: authorization.grantedScopeCeiling,
    required_oauth_scopes: authorization.requiredOAuthScopes,
    availability_scope: authorization.availabilityScope,
    calendar_scope: authorization.calendarScope,
    team_scope: authorization.teamScope,
  });
}

function queryHash(authorization: AuthorizedTeamAvailabilityRead) {
  assertCompanyCursor(authorization);
  return digest({
    view: authorization.query.view,
    starts_on: authorization.query.starts_on,
    ends_on: authorization.query.ends_on,
    limit: authorization.itemLimit,
  });
}

function exactSourceRevisions(revisions: readonly P2DomainRevision[]) {
  const parsed = ExactSourceRevisionsSchema.safeParse(revisions);
  if (!parsed.success) throw new P2ReadCursorError();
  return parsed.data;
}

function expectation(
  authorization: AuthorizedTeamAvailabilityRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  assertCompanyCursor(authorization);
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: TEAM_AVAILABILITY_RANKING_REVISION,
    actorUserId: authorization.actorContext.actorUserId,
    companyId: authorization.actorContext.companyId,
    oauthGrantId: authorization.oauthGrantId,
    grantedScopeDigest: authorityDigest(authorization),
    permissionSnapshotRevision:
      authorization.actorContext.permissionSnapshotRevision,
    queryHash: queryHash(authorization),
    sourceRevisions: exactSourceRevisions(sourceRevisions),
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

export interface TeamAvailabilityCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly predecessor: TeamAvailabilityCursorPredecessor;
}

export interface TeamAvailabilityCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedTeamAvailabilityRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: TeamAvailabilityCursorPredecessor;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedTeamAvailabilityRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): TeamAvailabilityCursorContext;
}

export function createTeamAvailabilityCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): TeamAvailabilityCursorService {
  const codec = createP2ReadCursorCodec(input);
  return Object.freeze({
    encode(
      value: {
        readonly authorization: AuthorizedTeamAvailabilityRead;
        readonly sourceRevisions: readonly P2DomainRevision[];
        readonly readAt: string;
        readonly predecessor: TeamAvailabilityCursorPredecessor;
      },
      nowSeconds?: number
    ) {
      assertCompanyCursor(value.authorization);
      const predecessor = TeamAvailabilityCursorPredecessorSchema.safeParse(
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
        readonly authorization: AuthorizedTeamAvailabilityRead;
        readonly token: string;
      },
      nowSeconds?: number
    ) {
      assertCompanyCursor(value.authorization);
      const hint = decodeHint(value.token);
      const claims = codec.decode(
        value.token,
        expectation(value.authorization, hint.source_revisions, hint.read_at),
        nowSeconds
      );
      const predecessor = TeamAvailabilityCursorPredecessorSchema.safeParse(
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

export function teamAvailabilityQueryHash(
  authorization: AuthorizedTeamAvailabilityRead
) {
  return queryHash(authorization);
}

export function teamAvailabilityAuthorityDigest(
  authorization: AuthorizedTeamAvailabilityRead
) {
  return authorityDigest(authorization);
}
