import "server-only";

import type { PermissionScope } from "@/lib/types/permissions";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import type { AuthorizedCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ParsedJobSummaryInput } from "@/lib/agent-control-plane/contracts/job-catalog";
import { authorizeTask13CapabilityReadInternal } from "./customer-jobs-authorization";

const CAPABILITY_ID = "get_job_summary" as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_JOB_SUMMARY_READ: unique symbol;

export interface AuthorizedJobSummaryRead {
  readonly [AUTHORIZED_JOB_SUMMARY_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly inboxScope: "all" | "assigned" | "own" | null;
  readonly clientsScope: "all" | "assigned" | null;
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
  readonly calendarScope: "all" | "own" | null;
  readonly tasksScope: "all" | "assigned" | null;
  readonly photosScope: "all" | "assigned" | null;
  readonly estimatesScope: "all" | "assigned" | null;
  readonly invoicesScope: "all" | "assigned" | null;
  readonly projectsFinancialsScope: "all" | null;
  readonly query: ParsedJobSummaryInput;
}

function scope<T extends PermissionScope>(
  value: PermissionScope | undefined,
  allowed: readonly T[]
): T | null {
  return value && allowed.includes(value as T) ? (value as T) : null;
}

export function authorizeJobSummaryRead(input: {
  readonly authorizations:
    AuthorizedCapability | readonly AuthorizedCapability[];
  readonly rawInput: unknown;
}): AuthorizedJobSummaryRead {
  const base = authorizeTask13CapabilityReadInternal<
    typeof CAPABILITY_ID,
    ParsedJobSummaryInput
  >({
    capabilityId: CAPABILITY_ID,
    errorNamespace: "job_summary",
    ...input,
  });
  const inboxScope = scope(base.resolvedPermissions["inbox.view"], [
    "all",
    "assigned",
    "own",
  ]);
  const clientsScope = scope(base.resolvedPermissions["clients.view"], [
    "all",
    "assigned",
  ]);
  const pipelineScope = scope(base.resolvedPermissions["pipeline.view"], [
    "all",
    "assigned",
  ]);
  const projectsScope = scope(base.resolvedPermissions["projects.view"], [
    "all",
    "assigned",
  ]);
  const calendarScope = scope(base.resolvedPermissions["calendar.view"], [
    "all",
    "own",
  ]);
  const tasksScope = scope(base.resolvedPermissions["tasks.view"], [
    "all",
    "assigned",
  ]);
  const photosScope = scope(base.resolvedPermissions["photos.view"], [
    "all",
    "assigned",
  ]);
  const estimatesScope = scope(base.resolvedPermissions["estimates.view"], [
    "all",
    "assigned",
  ]);
  const invoicesScope = scope(base.resolvedPermissions["invoices.view"], [
    "all",
    "assigned",
  ]);
  const projectsFinancialsScope = scope(
    base.resolvedPermissions["projects.view_financials"],
    ["all"]
  );

  const query = base.query;
  const rules = query.readiness_rule_codes ?? [];
  const components = query.financial_components ?? [];
  const needsSchedule = query.sections.includes("schedule");
  const needsReadinessSchedule = rules.some((rule) =>
    ["SCHEDULE_UNCONFIRMED", "CREW_UNASSIGNED"].includes(rule)
  );
  const needsActivity = query.sections.includes("activity");
  if (
    (query.job_ref.kind === "opportunity" && !pipelineScope) ||
    (query.job_ref.kind === "project" && !projectsScope) ||
    ((needsSchedule || needsReadinessSchedule || needsActivity) &&
      (!calendarScope || !tasksScope)) ||
    (needsActivity && query.job_ref.kind === "opportunity" && !projectsScope) ||
    (rules.includes("SITE_PHOTOS_MISSING") && !photosScope) ||
    (rules.includes("CUSTOMER_RECORD_UNRESOLVED") && !clientsScope) ||
    (query.sections.includes("participants") &&
      (!clientsScope || !inboxScope)) ||
    (query.sections.includes("activity") && !tasksScope) ||
    (query.sections.includes("conversation") && !inboxScope) ||
    (components.includes("estimate_rollup") && !estimatesScope) ||
    (components.includes("invoice_rollup") && !invoicesScope) ||
    (query.job_ref.kind === "project" &&
      components.length > 0 &&
      !projectsFinancialsScope)
  ) {
    throw authorizationInternal(
      base.actorContext.requestId,
      "job_summary_permission_union_invalid"
    );
  }

  const proof = Object.freeze({
    actorContext: base.actorContext,
    capabilityId: base.capabilityId,
    capabilityRevision: base.capabilityRevision,
    capabilityManifestRevision: base.capabilityManifestRevision,
    requiredOAuthScopes: base.requiredOAuthScopes,
    inboxScope,
    clientsScope,
    pipelineScope,
    projectsScope,
    calendarScope,
    tasksScope,
    photosScope,
    estimatesScope,
    invoicesScope,
    projectsFinancialsScope,
    query,
  });
  PROOFS.add(proof);
  return proof as unknown as AuthorizedJobSummaryRead;
}

export function isAuthorizedJobSummaryRead(
  value: unknown
): value is AuthorizedJobSummaryRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
