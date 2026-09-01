import "server-only";

import type { PermissionScope } from "@/lib/types/permissions";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import type { AuthorizedCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ParsedJobHistorySearchInput } from "@/lib/agent-control-plane/contracts/job-catalog";
import { authorizeTask13CapabilityReadInternal } from "./customer-jobs-authorization";

const CAPABILITY_ID = "search_job_history" as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_JOB_HISTORY_READ: unique symbol;

export interface AuthorizedJobHistoryRead {
  readonly [AUTHORIZED_JOB_HISTORY_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly calendarScope: "all" | "own" | null;
  readonly clientsScope: "all" | "assigned" | null;
  readonly inboxScope: "all" | "assigned" | "own" | null;
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
  readonly tasksScope: "all" | "assigned" | null;
  readonly estimatesScope: "all" | "assigned" | null;
  readonly projectsFinancialsScope: "all" | null;
  readonly query: ParsedJobHistorySearchInput;
}

function scope<T extends PermissionScope>(
  value: PermissionScope | undefined,
  allowed: readonly T[]
): T | null {
  return value && allowed.includes(value as T) ? (value as T) : null;
}

export function authorizeJobHistoryRead(input: {
  readonly authorizations:
    AuthorizedCapability | readonly AuthorizedCapability[];
  readonly rawInput: unknown;
}): AuthorizedJobHistoryRead {
  const base = authorizeTask13CapabilityReadInternal<
    typeof CAPABILITY_ID,
    ParsedJobHistorySearchInput
  >({
    capabilityId: CAPABILITY_ID,
    errorNamespace: "job_history",
    ...input,
  });
  const calendarScope = scope(base.resolvedPermissions["calendar.view"], [
    "all",
    "own",
  ]);
  const clientsScope = scope(base.resolvedPermissions["clients.view"], [
    "all",
    "assigned",
  ]);
  const inboxScope = scope(base.resolvedPermissions["inbox.view"], [
    "all",
    "assigned",
    "own",
  ]);
  const pipelineScope = scope(base.resolvedPermissions["pipeline.view"], [
    "all",
    "assigned",
  ]);
  const projectsScope = scope(base.resolvedPermissions["projects.view"], [
    "all",
    "assigned",
  ]);
  const tasksScope = scope(base.resolvedPermissions["tasks.view"], [
    "all",
    "assigned",
  ]);
  const estimatesScope = scope(base.resolvedPermissions["estimates.view"], [
    "all",
    "assigned",
  ]);
  const projectsFinancialsScope = scope(
    base.resolvedPermissions["projects.view_financials"],
    ["all"]
  );

  const query = base.query;
  const jobKinds =
    query.scope.kind === "customer"
      ? query.scope.job_kinds
      : Array.from(new Set(query.scope.job_refs.map(({ kind }) => kind)));
  const needsCorrespondence = query.source_types.some((sourceType) =>
    ["delivered_correspondence", "current_memory_summary"].includes(sourceType)
  );
  if (
    (query.scope.kind === "customer" && !clientsScope) ||
    (jobKinds.includes("opportunity") && !pipelineScope) ||
    (jobKinds.includes("project") && !projectsScope) ||
    (needsCorrespondence && !inboxScope) ||
    (query.source_types.includes("task_event") &&
      (!calendarScope || !projectsScope || !tasksScope)) ||
    (query.source_types.includes("estimate_document") && !estimatesScope) ||
    (query.source_types.includes("estimate_document") &&
      jobKinds.includes("project") &&
      !projectsFinancialsScope)
  ) {
    throw authorizationInternal(
      base.actorContext.requestId,
      "job_history_permission_union_invalid"
    );
  }

  const proof = Object.freeze({
    actorContext: base.actorContext,
    capabilityId: base.capabilityId,
    capabilityRevision: base.capabilityRevision,
    capabilityManifestRevision: base.capabilityManifestRevision,
    requiredOAuthScopes: base.requiredOAuthScopes,
    calendarScope,
    clientsScope,
    inboxScope,
    pipelineScope,
    projectsScope,
    tasksScope,
    estimatesScope,
    projectsFinancialsScope,
    query,
  });
  PROOFS.add(proof);
  return proof as unknown as AuthorizedJobHistoryRead;
}

export function isAuthorizedJobHistoryRead(
  value: unknown
): value is AuthorizedJobHistoryRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
