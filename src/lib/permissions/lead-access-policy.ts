import type { PermissionState } from "@/lib/store/permissions-store";
import type { Opportunity } from "@/lib/types/pipeline";

export type PipelineGranularPermission =
  | "pipeline.create"
  | "pipeline.view"
  | "pipeline.edit"
  | "pipeline.assign"
  | "pipeline.convert";

export type PipelineAccessScope = "all" | "assigned";
export type InboxViewAccessScope = "all" | "assigned" | "own";
export type InboxViewAccessSource = "granular" | "compat" | "denied";

export interface InboxViewAccess {
  scope: InboxViewAccessScope | null;
  source: InboxViewAccessSource;
}

/**
 * Client mirror of `private.effective_pipeline_scope_for_user`: an explicit
 * granular decision (including revoke/inert scope) is authoritative; legacy
 * manage-all is used only when that exact key is genuinely absent.
 */
export function effectivePipelineScope(
  state: Pick<PermissionState, "permissions" | "configuredPermissions" | "can">,
  permission: PipelineGranularPermission
): PipelineAccessScope | null {
  if (state.configuredPermissions.has(permission)) {
    const scope = state.permissions.get(permission);
    return scope === "all" || scope === "assigned" ? scope : null;
  }
  return state.can("pipeline.manage", "all") ? "all" : null;
}

export function canCreateLead(
  state: Pick<PermissionState, "permissions" | "configuredPermissions" | "can">
): boolean {
  return effectivePipelineScope(state, "pipeline.create") === "all";
}

/**
 * Client mirror of `private.effective_inbox_scope_for_user`. An explicit
 * granular row, including a revoke or inert scope, is authoritative. The
 * hidden company-wide alias is consulted only while that granular key is
 * genuinely absent during migration compatibility.
 */
export function effectiveInboxViewAccess(
  state: Pick<PermissionState, "permissions" | "configuredPermissions" | "can">
): InboxViewAccess {
  if (state.configuredPermissions.has("inbox.view")) {
    const scope = state.permissions.get("inbox.view");
    if (scope === "all" || scope === "assigned" || scope === "own") {
      return { scope, source: "granular" };
    }
    return { scope: null, source: "denied" };
  }
  if (state.can("inbox.view_company", "all")) {
    return { scope: "all", source: "compat" };
  }
  return { scope: null, source: "denied" };
}

export interface LeadAccess {
  canView: boolean;
  canEdit: boolean;
  canAssign: boolean;
  canUnassign: boolean;
  canConvert: boolean;
}

export const NO_LEAD_ACCESS: LeadAccess = Object.freeze({
  canView: false,
  canEdit: false,
  canAssign: false,
  canUnassign: false,
  canConvert: false,
});

function scopeCoversRow(
  scope: PipelineAccessScope | null,
  actorUserId: string | null,
  assignedTo: string | null
): boolean {
  return (
    scope === "all" ||
    (scope === "assigned" && actorUserId !== null && assignedTo === actorUserId)
  );
}

export function getLeadAccess(
  state: Pick<PermissionState, "permissions" | "configuredPermissions" | "can">,
  actorUserId: string | null,
  opportunity: Pick<
    Opportunity,
    "assignedTo" | "stage" | "archivedAt" | "deletedAt"
  >
): LeadAccess {
  if (opportunity.deletedAt !== null) {
    return {
      canView: false,
      canEdit: false,
      canAssign: false,
      canUnassign: false,
      canConvert: false,
    };
  }

  const viewScope = effectivePipelineScope(state, "pipeline.view");
  const editScope = effectivePipelineScope(state, "pipeline.edit");
  const assignScope = effectivePipelineScope(state, "pipeline.assign");
  const convertScope = effectivePipelineScope(state, "pipeline.convert");
  const canView = scopeCoversRow(
    viewScope,
    actorUserId,
    opportunity.assignedTo
  );
  const canEdit =
    canView && scopeCoversRow(editScope, actorUserId, opportunity.assignedTo);
  const assignedResponsibilityIsActive =
    opportunity.archivedAt === null &&
    !["won", "lost", "discarded"].includes(opportunity.stage);

  return {
    canView,
    canEdit,
    canAssign:
      canEdit &&
      (assignScope === "all" ||
        (assignScope === "assigned" &&
          assignedResponsibilityIsActive &&
          actorUserId !== null &&
          opportunity.assignedTo === actorUserId)),
    canUnassign: canEdit && assignScope === "all",
    canConvert:
      canEdit &&
      scopeCoversRow(convertScope, actorUserId, opportunity.assignedTo),
  };
}
