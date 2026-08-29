import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  GetJobArtifactEvidenceInputSchema,
  JobArtifactListInputSchema,
  type ArtifactSourceKind,
  type GetJobArtifactEvidenceInput,
  type JobArtifactListInput,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
import {
  GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
  LIST_JOB_ARTIFACTS_CANDIDATE,
  selectedGetJobArtifactEvidenceVariantKeys,
  selectedListJobArtifactsVariantKeys,
  type ArtifactAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/artifacts";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";

const AUTHORIZED_LIST_ARTIFACT_READS = new WeakSet<object>();
const AUTHORIZED_EXACT_ARTIFACT_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class ArtifactReadAuthorizationError extends Error {
  readonly code = "ARTIFACT_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("ARTIFACT_READ_AUTHORIZATION_INVALID");
    this.name = "ArtifactReadAuthorizationError";
  }
}

interface AuthorizedArtifactReadBase {
  readonly actorContext: ActorContext;
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly variantKeys: readonly ArtifactAuthorizationVariantKey[];
}

export interface AuthorizedListJobArtifactsRead extends AuthorizedArtifactReadBase {
  readonly capabilityId: "list_job_artifacts";
  readonly capabilityRevision: "list_job_artifacts:2026-08-22.v1";
  readonly query: JobArtifactListInput;
  readonly sourceKinds: readonly ArtifactSourceKind[];
}

export interface AuthorizedGetJobArtifactEvidenceRead extends AuthorizedArtifactReadBase {
  readonly capabilityId: "get_job_artifact_evidence";
  readonly capabilityRevision: "get_job_artifact_evidence:2026-08-22.v1";
  readonly query: GetJobArtifactEvidenceInput;
  readonly sourceKinds: readonly [ArtifactSourceKind];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].sort((left, right) => left.localeCompare(right))
  );
}

function canonicalListQuery(input: unknown): JobArtifactListInput {
  const parsed = JobArtifactListInputSchema.parse(input);
  return deepFreeze({
    ...parsed,
    job_ref: { ...parsed.job_ref },
    source_kinds: [...parsed.source_kinds].sort((left, right) =>
      left.localeCompare(right)
    ),
  });
}

function canonicalExactQuery(input: unknown): GetJobArtifactEvidenceInput {
  const parsed = GetJobArtifactEvidenceInputSchema.parse(input);
  return deepFreeze({
    ...parsed,
    job_ref: { ...parsed.job_ref },
  });
}

function exactAuthorizationRecord(
  value: unknown,
  expectedKeys: readonly ArtifactAuthorizationVariantKey[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new ArtifactReadAuthorizationError();
  }
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right)
  );
  const expected = [...expectedKeys].sort((left, right) =>
    left.localeCompare(right)
  );
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ArtifactReadAuthorizationError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertMcpActor(actorContext: ActorContext) {
  const auth = actorContext.auth;
  if (
    auth.channel !== "mcp" ||
    !CANONICAL_UUID_PATTERN.test(auth.oauthGrantId) ||
    !CANONICAL_UUID_PATTERN.test(auth.oauthClientId) ||
    !GRANT_REVISION_PATTERN.test(auth.grantRevision) ||
    auth.scopeCeiling.length === 0
  ) {
    throw new ArtifactReadAuthorizationError();
  }
  return auth;
}

function bindVariants(input: {
  readonly candidate:
    | typeof LIST_JOB_ARTIFACTS_CANDIDATE
    | typeof GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE;
  readonly capabilityId: "get_job_artifact_evidence" | "list_job_artifacts";
  readonly capabilityRevision:
    | "get_job_artifact_evidence:2026-08-22.v1"
    | "list_job_artifacts:2026-08-22.v1";
  readonly variantKeys: readonly ArtifactAuthorizationVariantKey[];
  readonly authorizations: unknown;
}) {
  const authorizations = exactAuthorizationRecord(
    input.authorizations,
    input.variantKeys
  );
  const policies = new Map(
    input.candidate.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  let actorContext: ActorContext | null = null;
  const requiredOAuthScopes: string[] = [];
  const resolvedPermissionScopes: Record<string, PermissionScope> = {};

  for (const key of input.variantKeys) {
    const policy = policies.get(key);
    if (!policy) throw new ArtifactReadAuthorizationError();
    const declaredPermissions = sortedUnique(
      policy.permissionRequirementGroups.flatMap((group) =>
        group.map((requirement) => requirement.permission)
      )
    );
    const binding = assertP2ReadPolicyBinding({
      authorization: authorizations[key],
      policy,
      expected: {
        capabilityId: input.capabilityId,
        capabilityRevision: input.capabilityRevision,
        capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
        requiredOAuthScopes: policy.requiredOAuthScopes,
        declaredPermissions,
        satisfiedPermissionGroupIndexes: [0],
        resolvedPermissionKeys: declaredPermissions,
      },
    });
    if (actorContext && binding.actorContext !== actorContext) {
      throw new ArtifactReadAuthorizationError();
    }
    actorContext ??= binding.actorContext;
    requiredOAuthScopes.push(...binding.requiredOAuthScopes);
    for (const [permission, scope] of Object.entries(
      binding.resolvedPermissions
    )) {
      const existing = resolvedPermissionScopes[permission];
      if (existing && existing !== scope) {
        throw new ArtifactReadAuthorizationError();
      }
      resolvedPermissionScopes[permission] = scope;
    }
  }

  if (!actorContext) throw new ArtifactReadAuthorizationError();
  const auth = assertMcpActor(actorContext);
  return deepFreeze({
    actorContext,
    requiredOAuthScopes: sortedUnique(requiredOAuthScopes),
    resolvedPermissionScopes: Object.fromEntries(
      Object.entries(resolvedPermissionScopes).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: sortedUnique(auth.scopeCeiling),
  });
}

export function authorizeListJobArtifactsRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedListJobArtifactsRead {
  try {
    const query = canonicalListQuery(input.query);
    const variantKeys = selectedListJobArtifactsVariantKeys(query);
    const binding = bindVariants({
      candidate: LIST_JOB_ARTIFACTS_CANDIDATE,
      capabilityId: "list_job_artifacts",
      capabilityRevision: "list_job_artifacts:2026-08-22.v1",
      variantKeys,
      authorizations: input.authorizations,
    });
    const proof = deepFreeze({
      ...binding,
      capabilityId: "list_job_artifacts" as const,
      capabilityRevision: "list_job_artifacts:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      sourceKinds: [...query.source_kinds],
      variantKeys: [...variantKeys],
    });
    AUTHORIZED_LIST_ARTIFACT_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof ArtifactReadAuthorizationError) throw error;
    throw new ArtifactReadAuthorizationError();
  }
}

export function authorizeGetJobArtifactEvidenceRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedGetJobArtifactEvidenceRead {
  try {
    const query = canonicalExactQuery(input.query);
    const variantKeys = selectedGetJobArtifactEvidenceVariantKeys(query);
    const binding = bindVariants({
      candidate: GET_JOB_ARTIFACT_EVIDENCE_CANDIDATE,
      capabilityId: "get_job_artifact_evidence",
      capabilityRevision: "get_job_artifact_evidence:2026-08-22.v1",
      variantKeys,
      authorizations: input.authorizations,
    });
    const proof = deepFreeze({
      ...binding,
      capabilityId: "get_job_artifact_evidence" as const,
      capabilityRevision: "get_job_artifact_evidence:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      sourceKinds: [query.source_kind] as const,
      variantKeys: [...variantKeys],
    });
    AUTHORIZED_EXACT_ARTIFACT_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof ArtifactReadAuthorizationError) throw error;
    throw new ArtifactReadAuthorizationError();
  }
}

export function isAuthorizedListJobArtifactsRead(
  value: unknown
): value is AuthorizedListJobArtifactsRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_LIST_ARTIFACT_READS.has(value)
  );
}

export function isAuthorizedGetJobArtifactEvidenceRead(
  value: unknown
): value is AuthorizedGetJobArtifactEvidenceRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_EXACT_ARTIFACT_READS.has(value)
  );
}
