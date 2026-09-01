import "server-only";

import { createHash } from "node:crypto";

import type {
  GetTaskContextResult,
  TaskSummarySchema,
} from "@/lib/agent-control-plane/contracts/tasks";
import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type { z } from "zod-v4";
import type {
  AuthorizedGetTaskContextRead,
  AuthorizedListTasksRead,
} from "./task-authorization";
import type { TaskListCursorContext } from "./task-cursor";

type TaskSummary = z.infer<typeof TaskSummarySchema>;

export interface TaskListSourceRevision {
  readonly domain: "legacy_operational" | "tasks";
  readonly source_revision: number;
}

function exactTaskSourceRevisions(
  revisions: readonly P2DomainRevision[]
): readonly TaskListSourceRevision[] {
  if (
    revisions.length !== 2 ||
    revisions[0]?.domain !== "legacy_operational" ||
    revisions[1]?.domain !== "tasks"
  ) {
    throw new TypeError("TASK_REVISION_VECTOR_INVALID");
  }
  return [
    {
      domain: "legacy_operational",
      source_revision: revisions[0].source_revision,
    },
    { domain: "tasks", source_revision: revisions[1].source_revision },
  ];
}

export interface TaskListProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "list_tasks";
  readonly capability_revision: "list_tasks:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly ranking_revision: "task-ranking:2026-08-22.v1";
  readonly required_oauth_scopes: readonly string[];
  readonly tasks_scope: "all" | "assigned";
  readonly projects_scope: "all" | "assigned";
  readonly calendar_scope: "all" | "own" | null;
  readonly estimates_scope: null;
  readonly project_financials_scope: null;
  readonly view: AuthorizedListTasksRead["query"]["view"];
  readonly item_limit: number;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly TaskListSourceRevision[];
  readonly cursor_predecessor: TaskListCursorContext["predecessor"] | null;
  readonly read_at: string;
  readonly source_revisions: readonly TaskListSourceRevision[];
  readonly source_inspected: number;
  readonly source_has_more: boolean;
}

export interface TaskDetailSourceInspected {
  readonly assignees: number;
  readonly dependencies: number;
  readonly task_evidence: number;
  readonly materials: number;
}

export interface TaskContextProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "get_task_context";
  readonly capability_revision: "get_task_context:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly required_oauth_scopes: readonly string[];
  readonly tasks_scope: "all" | "assigned";
  readonly projects_scope: "all" | "assigned";
  readonly calendar_scope: "all" | "own" | null;
  readonly estimates_scope: "all" | "assigned" | null;
  readonly project_financials_scope: "all" | null;
  readonly task_ref: AuthorizedGetTaskContextRead["query"]["task_ref"];
  readonly selected_sections: AuthorizedGetTaskContextRead["query"]["sections"];
  readonly read_at: string;
  readonly source_revisions: readonly TaskListSourceRevision[];
  readonly source_inspected: TaskDetailSourceInspected;
}

export interface TaskCollectionChildProof {
  readonly task_ref: TaskSummary["task_ref"];
  readonly proof_ref: string;
  readonly evidence_ref: string;
}

const PRIORITY_TEXT_PATTERN =
  /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/i;

function priorityProofText(input: {
  readonly task: TaskSummary;
  readonly priorityRankText: string | null;
}): string | null {
  if (input.task.priority.state === "not_recorded") {
    if (input.priorityRankText !== null)
      throw new TypeError("TASK_PRIORITY_PROOF_INVALID");
    return null;
  }
  const text = input.priorityRankText;
  if (
    text === null ||
    text.length > 64 ||
    !PRIORITY_TEXT_PATTERN.test(text) ||
    !Number.isFinite(Number(text)) ||
    Number(text) !== input.task.priority.rank
  ) {
    throw new TypeError("TASK_PRIORITY_PROOF_INVALID");
  }
  return text;
}

export function taskSummaryProofProjection(input: {
  readonly task: TaskSummary;
  readonly priorityRankText: string | null;
}) {
  const rank = priorityProofText(input);
  return {
    ...input.task,
    priority:
      input.task.priority.state === "not_recorded"
        ? input.task.priority
        : { state: "recorded" as const, rank },
  };
}

function proofRef(material: unknown): `ops_proof:v1:${string}` {
  return `ops_proof:v1:${createHash("sha256")
    .update(canonicalOperationalProjection(material as never), "utf8")
    .digest("hex")}`;
}

function evidenceRef(material: unknown): `ops_evidence:v1:${string}` {
  return `ops_evidence:v1:${createHash("sha256")
    .update(canonicalOperationalProjection(material as never), "utf8")
    .digest("hex")}`;
}

export function taskListProofContext(input: {
  readonly authorization: AuthorizedListTasksRead;
  readonly cursor: TaskListCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}): TaskListProofContext {
  const authorization = input.authorization;
  return {
    company_id: authorization.actorContext.companyId,
    actor_user_id: authorization.actorContext.actorUserId,
    oauth_grant_id: authorization.oauthGrantId,
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    ranking_revision: "task-ranking:2026-08-22.v1",
    required_oauth_scopes: authorization.requiredOAuthScopes,
    tasks_scope: authorization.tasksScope,
    projects_scope: authorization.projectsScope,
    calendar_scope: authorization.calendarScope,
    estimates_scope: null,
    project_financials_scope: null,
    view: authorization.query.view,
    item_limit: authorization.query.limit,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor
      ? exactTaskSourceRevisions(input.cursor.sourceRevisions)
      : [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: exactTaskSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function taskListEntityProofRef(input: {
  readonly context: TaskListProofContext;
  readonly task: TaskSummary;
  readonly priorityRankText: string | null;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "task_list_entity",
    task: taskSummaryProofProjection(input),
  });
}

export function taskListEvidenceRef(input: {
  readonly context: TaskListProofContext;
  readonly taskRef: TaskSummary["task_ref"];
}) {
  return evidenceRef({
    ...input.context,
    proof_kind: "task_list_evidence",
    task_ref: input.taskRef,
  });
}

export function taskListCollectionProofRef(input: {
  readonly context: TaskListProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly TaskCollectionChildProof[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "task_list_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}

export function taskContextProofContext(input: {
  readonly authorization: AuthorizedGetTaskContextRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: TaskDetailSourceInspected;
}): TaskContextProofContext {
  const authorization = input.authorization;
  return {
    company_id: authorization.actorContext.companyId,
    actor_user_id: authorization.actorContext.actorUserId,
    oauth_grant_id: authorization.oauthGrantId,
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    required_oauth_scopes: authorization.requiredOAuthScopes,
    tasks_scope: authorization.tasksScope,
    projects_scope: authorization.projectsScope,
    calendar_scope: authorization.calendarScope,
    estimates_scope: authorization.estimatesScope,
    project_financials_scope: authorization.projectFinancialsScope,
    task_ref: authorization.query.task_ref,
    selected_sections: authorization.query.sections,
    read_at: input.readAt,
    source_revisions: exactTaskSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
  };
}

export function taskContextEntityProofRef(input: {
  readonly context: TaskContextProofContext;
  readonly result: Omit<GetTaskContextResult, "evidence" | "proof">;
  readonly priorityRankText: string | null;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "task_context_entity",
    result: {
      ...input.result,
      task: taskSummaryProofProjection({
        task: input.result.task,
        priorityRankText: input.priorityRankText,
      }),
    },
  });
}

export function taskContextEvidenceRef(input: {
  readonly context: TaskContextProofContext;
}) {
  return evidenceRef({
    ...input.context,
    proof_kind: "task_context_evidence",
  });
}
