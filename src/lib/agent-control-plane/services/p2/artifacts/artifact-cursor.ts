import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod-v4";

import {
  P2CanonicalTimestampSchema,
  P2DomainRevisionVectorSchema,
  P2EvidenceRefSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import {
  ArtifactSourceKindSchema,
  type ArtifactSourceKind,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import { createP2ReadCursorCodec, P2ReadCursorError } from "../shared/cursor";
import type { AuthorizedListJobArtifactsRead } from "./artifact-authorization";

export const ARTIFACT_LIST_RANKING_REVISION =
  "artifact-ranking:2026-08-22.v1" as const;

const CursorHintSchema = z
  .object({
    read_at: P2CanonicalTimestampSchema,
    source_revisions: P2DomainRevisionVectorSchema,
  })
  .passthrough()
  .refine(
    (hint) =>
      hint.source_revisions.length === 2 &&
      hint.source_revisions[0]?.domain === "artifacts" &&
      hint.source_revisions[1]?.domain === "legacy_operational",
    "ARTIFACT_CURSOR_REVISION_VECTOR_INVALID"
  );
const ArtifactPredecessorSchema = z
  .object({
    order: z.tuple([
      P2CanonicalTimestampSchema,
      ArtifactSourceKindSchema,
      P2EvidenceRefSchema,
    ]),
    tie_breaker: P2EvidenceRefSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[2] === predecessor.tie_breaker,
    "ARTIFACT_CURSOR_PREDECESSOR_INVALID"
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

function scopeDigest(authorization: AuthorizedListJobArtifactsRead) {
  return digest({ scope_ceiling: authorization.grantedScopeCeiling });
}

function queryHash(authorization: AuthorizedListJobArtifactsRead) {
  return digest({
    job_ref: authorization.query.job_ref,
    source_kinds: authorization.sourceKinds,
    limit: authorization.query.limit,
  });
}

function expectation(
  authorization: AuthorizedListJobArtifactsRead,
  sourceRevisions: readonly P2DomainRevision[],
  readAt: string
) {
  return {
    capabilityId: authorization.capabilityId,
    schemaRevision: "2026-08-22.v1",
    capabilityManifestRevision: authorization.capabilityManifestRevision,
    rankingRevision: ARTIFACT_LIST_RANKING_REVISION,
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
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
      throw new P2ReadCursorError();
    }
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

export interface ArtifactListPredecessor {
  readonly order: readonly [string, ArtifactSourceKind, string];
  readonly tie_breaker: string;
}

export interface ArtifactListCursorContext {
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly predecessor: ArtifactListPredecessor;
}

export interface ArtifactListCursorService {
  encode(
    input: {
      readonly authorization: AuthorizedListJobArtifactsRead;
      readonly sourceRevisions: readonly P2DomainRevision[];
      readonly readAt: string;
      readonly predecessor: ArtifactListPredecessor;
    },
    nowSeconds?: number
  ): string;
  decode(
    input: {
      readonly authorization: AuthorizedListJobArtifactsRead;
      readonly token: string;
    },
    nowSeconds?: number
  ): ArtifactListCursorContext;
}

export function createArtifactListCursorService(input: {
  readonly keyId: string;
  readonly key: Uint8Array;
}): ArtifactListCursorService {
  const codec = createP2ReadCursorCodec(input);
  const service: ArtifactListCursorService = {
    encode(value, nowSeconds?: number) {
      const predecessor = ArtifactPredecessorSchema.parse(value.predecessor);
      return codec.encode(
        {
          ...expectation(
            value.authorization,
            value.sourceRevisions,
            value.readAt
          ),
          predecessor,
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
      const predecessor = ArtifactPredecessorSchema.parse(claims.predecessor);
      return deepFreeze({
        readAt: claims.read_at,
        sourceRevisions: claims.source_revisions.map((revision) => ({
          ...revision,
        })),
        predecessor: {
          order: [...predecessor.order],
          tie_breaker: predecessor.tie_breaker,
        },
      });
    },
  };
  return Object.freeze(service);
}

export function artifactListQueryHash(
  authorization: AuthorizedListJobArtifactsRead
) {
  return queryHash(authorization);
}

export function artifactGrantedScopeDigest(
  authorization: AuthorizedListJobArtifactsRead
) {
  return scopeDigest(authorization);
}
