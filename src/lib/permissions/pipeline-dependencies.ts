import type { PermissionScope } from "@/lib/types/permissions";

export interface PermissionEditState {
  permission: string;
  scope: PermissionScope;
  enabled: boolean;
}

export interface PermissionGrantInput {
  permission: string;
  scope: unknown;
  enabled?: boolean;
}

/**
 * Convert editor rows into the desired-state map used by member overrides.
 * Hidden compatibility permissions are deliberately absent, which means the
 * diff engine cannot rewrite or self-heal their stored override rows.
 */
export function buildEditablePermissionDesiredState(
  edits: ReadonlyMap<string, PermissionEditState>,
  hiddenPermissionIds: ReadonlySet<string>
): Map<string, PermissionScope | null> {
  const desired = new Map<string, PermissionScope | null>();
  for (const [permission, edit] of edits) {
    if (hiddenPermissionIds.has(permission)) continue;
    desired.set(permission, edit.enabled ? edit.scope : null);
  }
  return desired;
}

type PipelinePermission =
  | "pipeline.create"
  | "pipeline.view"
  | "pipeline.edit"
  | "pipeline.assign"
  | "pipeline.convert";

type PipelineScope = "all" | "assigned";

export type PipelineDependencyIssue =
  | {
      code: "duplicate_permission";
      permission: PipelinePermission;
    }
  | {
      code: "unsupported_scope";
      permission: PipelinePermission;
      scope: unknown;
    }
  | {
      code:
        | "create_requires_view"
        | "edit_exceeds_view"
        | "assign_exceeds_edit"
        | "convert_exceeds_edit";
      permission: PipelinePermission;
      dependency: PipelinePermission;
      scope: PipelineScope;
      dependencyScope: PipelineScope | null;
    };

const PIPELINE_PERMISSIONS: readonly PipelinePermission[] = [
  "pipeline.create",
  "pipeline.view",
  "pipeline.edit",
  "pipeline.assign",
  "pipeline.convert",
];

const SUPPORTED_SCOPES: Record<PipelinePermission, readonly PipelineScope[]> = {
  "pipeline.create": ["all"],
  "pipeline.view": ["all", "assigned"],
  "pipeline.edit": ["all", "assigned"],
  "pipeline.assign": ["all", "assigned"],
  "pipeline.convert": ["all", "assigned"],
};

const ISSUE_ORDER: Record<PipelineDependencyIssue["code"], number> = {
  duplicate_permission: 0,
  unsupported_scope: 1,
  create_requires_view: 2,
  edit_exceeds_view: 3,
  assign_exceeds_edit: 4,
  convert_exceeds_edit: 5,
};

function isSupportedScope(
  permission: PipelinePermission,
  scope: unknown
): scope is PipelineScope {
  return SUPPORTED_SCOPES[permission].includes(scope as PipelineScope);
}

function scopeRank(scope: PipelineScope | null): number {
  if (scope === "all") return 2;
  if (scope === "assigned") return 1;
  return 0;
}

function widestScope(scopes: PipelineScope[]): PipelineScope | null {
  if (scopes.includes("all")) return "all";
  if (scopes.includes("assigned")) return "assigned";
  return null;
}

/**
 * Validate a final grant set without mutating it. The fixed issue ordering is
 * part of the API contract so client and server surfaces can report identical
 * malformed states.
 */
export function validatePipelinePermissionDependencies(
  grants: readonly PermissionGrantInput[]
): PipelineDependencyIssue[] {
  const issues: PipelineDependencyIssue[] = [];
  const scopes = new Map<PipelinePermission, PipelineScope | null>();

  for (const permission of PIPELINE_PERMISSIONS) {
    const rows = grants.filter(
      (grant) => grant.enabled !== false && grant.permission === permission
    );

    if (rows.length > 1) {
      issues.push({ code: "duplicate_permission", permission });
    }

    const validScopes: PipelineScope[] = [];
    for (const row of rows) {
      if (!isSupportedScope(permission, row.scope)) {
        issues.push({
          code: "unsupported_scope",
          permission,
          scope: row.scope,
        });
      } else {
        validScopes.push(row.scope);
      }
    }
    scopes.set(permission, widestScope(validScopes));
  }

  const createScope = scopes.get("pipeline.create") ?? null;
  const viewScope = scopes.get("pipeline.view") ?? null;
  const editScope = scopes.get("pipeline.edit") ?? null;
  const assignScope = scopes.get("pipeline.assign") ?? null;
  const convertScope = scopes.get("pipeline.convert") ?? null;

  if (createScope && scopeRank(viewScope) < scopeRank("assigned")) {
    issues.push({
      code: "create_requires_view",
      permission: "pipeline.create",
      dependency: "pipeline.view",
      scope: createScope,
      dependencyScope: viewScope,
    });
  }
  if (editScope && scopeRank(editScope) > scopeRank(viewScope)) {
    issues.push({
      code: "edit_exceeds_view",
      permission: "pipeline.edit",
      dependency: "pipeline.view",
      scope: editScope,
      dependencyScope: viewScope,
    });
  }
  if (assignScope && scopeRank(assignScope) > scopeRank(editScope)) {
    issues.push({
      code: "assign_exceeds_edit",
      permission: "pipeline.assign",
      dependency: "pipeline.edit",
      scope: assignScope,
      dependencyScope: editScope,
    });
  }
  if (convertScope && scopeRank(convertScope) > scopeRank(editScope)) {
    issues.push({
      code: "convert_exceeds_edit",
      permission: "pipeline.convert",
      dependency: "pipeline.edit",
      scope: convertScope,
      dependencyScope: editScope,
    });
  }

  return issues.sort((left, right) => {
    const codeOrder = ISSUE_ORDER[left.code] - ISSUE_ORDER[right.code];
    if (codeOrder !== 0) return codeOrder;
    const permissionOrder = left.permission.localeCompare(right.permission);
    if (permissionOrder !== 0) return permissionOrder;
    const leftScope = "scope" in left ? String(left.scope) : "";
    const rightScope = "scope" in right ? String(right.scope) : "";
    return leftScope.localeCompare(rightScope);
  });
}

/**
 * Fail-safe UI normalization. It can only narrow or disable a pipeline action;
 * it never widens a prerequisite, legacy compatibility grant, or other module.
 */
export function normalizePipelinePermissionEdits<T extends PermissionEditState>(
  edits: ReadonlyMap<string, T>
): Map<string, T> {
  const normalized = new Map(edits);

  const replace = (
    permission: PipelinePermission,
    patch: Partial<PermissionEditState>
  ) => {
    const current = normalized.get(permission);
    if (!current) return;
    normalized.set(permission, { ...current, ...patch } as T);
  };

  const activeScope = (
    permission: PipelinePermission
  ): PipelineScope | null => {
    const edit = normalized.get(permission);
    if (!edit?.enabled || !isSupportedScope(permission, edit.scope))
      return null;
    return edit.scope;
  };

  for (const permission of PIPELINE_PERMISSIONS) {
    const edit = normalized.get(permission);
    if (edit?.enabled && !isSupportedScope(permission, edit.scope)) {
      replace(permission, { enabled: false });
    }
  }

  const viewScope = activeScope("pipeline.view");
  if (
    activeScope("pipeline.create") &&
    scopeRank(viewScope) < scopeRank("assigned")
  ) {
    replace("pipeline.create", { enabled: false });
  }

  const cap = (
    permission: PipelinePermission,
    maximum: PipelineScope | null
  ) => {
    const current = activeScope(permission);
    if (!current) return;
    if (!maximum) {
      replace(permission, { enabled: false });
      return;
    }
    if (scopeRank(current) > scopeRank(maximum)) {
      replace(permission, { scope: maximum });
    }
  };

  cap("pipeline.edit", viewScope);
  const editScope = activeScope("pipeline.edit");
  cap("pipeline.assign", editScope);
  cap("pipeline.convert", editScope);

  return normalized;
}
