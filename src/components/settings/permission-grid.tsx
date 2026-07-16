"use client";

/**
 * Shared permission-grid primitives — the tier/scope row grammar used by both
 * the Roles editor (role defaults) and the Team member access editor
 * (per-member exceptions layered on a role).
 *
 * `ModulePermissionRow` gains an optional exception affordance: in member mode
 * a deviated module carries an EXCEPTION tag and a reset-to-role control. In
 * role mode those props are omitted and the row renders exactly as before —
 * roles-tab imports SectionLabel + ModulePermissionRow from here with zero
 * visual change.
 */

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/register-table";
import { SegmentControl, type SegmentControlOption } from "@/components/ui/segment-control";
import type {
  PermissionModule,
  PermissionScope,
  PermissionTier,
} from "@/lib/types/permissions";
import type { PermissionEditState } from "@/lib/permissions/pipeline-dependencies";
import { useDictionary } from "@/i18n/client";

/** A module's tier as an editor renders it: an explicit tier or "none". */
export type ModuleTierValue = PermissionTier | "none";

/** How a member's module deviates from their role — drives the exception tag. */
export type ModuleExceptionKind = "added" | "widened" | "narrowed" | "revoked" | "mixed";

// ─── Section header (// TITLE) ───────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

// ─── Module permission row (tier + scope, optional exception) ────────────────

export function ModulePermissionRow({
  moduleId,
  label,
  tier,
  isCustom,
  scope,
  scopeOptions,
  disabled,
  exception,
  onTierChange,
  onScopeChange,
  onReset,
}: {
  moduleId: string;
  label: string;
  /** The active tier segment, or "none" when no permissions are enabled. */
  tier: ModuleTierValue;
  /** Enabled perms exist but map to no clean tier (a non-tier action mix). */
  isCustom: boolean;
  scope: PermissionScope;
  /** Scope segments this module's actions actually offer (empty → no scope control). */
  scopeOptions: SegmentControlOption<PermissionScope>[];
  disabled?: boolean;
  /** Member mode only: the module deviates from the role; drives tag + reset. */
  exception?: ModuleExceptionKind;
  onTierChange: (moduleId: string, tier: ModuleTierValue) => void;
  onScopeChange: (moduleId: string, scope: PermissionScope) => void;
  /** Member mode only: return this module to the role default. */
  onReset?: (moduleId: string) => void;
}) {
  const { t } = useDictionary("settings");

  const tierOptions: SegmentControlOption<ModuleTierValue>[] = [
    { value: "none", label: t("roles.tierNone") },
    { value: "view", label: t("roles.tierViewOnly") },
    { value: "manage", label: t("roles.tierManage") },
    { value: "full", label: t("roles.tierFullAccess") },
  ];

  const showScope = tier !== "none" && scopeOptions.length > 1;

  return (
    <div className="flex items-center gap-1.5 border-b border-border-subtle py-1.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate font-mohave text-body-sm text-text">{label}</span>
        {isCustom && <Tag variant="tan">{t("roles.customPermissions")}</Tag>}
        {exception && (
          <Tag variant="tan">{t(`team.access.exception.${exception}`)}</Tag>
        )}
        {exception && onReset && !disabled && (
          <button
            type="button"
            onClick={() => onReset(moduleId)}
            aria-label={t("team.access.resetModule")}
            className="rounded p-[3px] text-text-3 transition-colors duration-150 hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            <RotateCcw className="h-[12px] w-[12px]" />
          </button>
        )}
      </div>

      {showScope && (
        <SegmentControl
          options={scopeOptions}
          value={scope}
          onChange={(s) => onScopeChange(moduleId, s)}
          className={disabled ? "pointer-events-none opacity-40" : undefined}
        />
      )}

      <SegmentControl
        options={tierOptions}
        value={isCustom ? "none" : tier}
        onChange={(v) => onTierChange(moduleId, v)}
        className={disabled ? "pointer-events-none opacity-40" : undefined}
      />
    </div>
  );
}

// ─── Action-level permission module ─────────────────────────────────────────

function ActionPermissionModule({
  module,
  edits,
  disabled,
  exception,
  onActionChange,
  onReset,
}: {
  module: PermissionModule;
  edits: ReadonlyMap<string, PermissionEditState>;
  disabled?: boolean;
  exception?: ModuleExceptionKind;
  onActionChange: (permission: string, scope: PermissionScope | null) => void;
  onReset?: (moduleId: string) => void;
}) {
  const { t } = useDictionary("settings");
  const moduleLabel = t(`roles.permissionModule.${module.id}`, module.label);
  const description =
    module.id === "pipeline"
      ? t("roles.pipelineDependencyHint")
      : module.id === "inbox"
        ? t("roles.inboxScopeHint")
        : null;

  return (
    <div className="border-b border-border-subtle py-1.5 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-mohave text-body-sm text-text">{moduleLabel}</span>
            {exception && (
              <Tag variant="tan">{t(`team.access.exception.${exception}`)}</Tag>
            )}
            {exception && onReset && !disabled && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onReset(module.id)}
                aria-label={t("team.access.resetModule")}
                className="h-7 w-7 text-text-3"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
          </div>
          {description && (
            <p className="mt-0.5 font-mono text-micro leading-relaxed text-text-3">
              {description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-1.5 space-y-1 border-l border-border-subtle pl-2">
        {module.actions
          .filter((action) => !action.hiddenFromEditor)
          .map((action) => {
            const edit = edits.get(action.id);
            const value: PermissionScope | "none" = edit?.enabled
              ? edit.scope
              : "none";
            const actionLabel = t(
              `roles.permissionAction.${action.id}`,
              action.label,
            );
            const options: SegmentControlOption<PermissionScope | "none">[] = [
              { value: "none", label: t("roles.tierNone") },
              ...action.scopes.map((scope) => ({
                value: scope,
                label:
                  scope === "all"
                    ? t("roles.scopeAll")
                    : scope === "assigned"
                      ? t("roles.scopeAssignedOnly")
                      : t("roles.scopeOwn"),
              })),
            ];

            return (
              <div
                key={action.id}
                className="flex flex-wrap items-center justify-between gap-2 py-0.5"
              >
                <span className="min-w-0 truncate font-mohave text-body-sm text-text-2">
                  {actionLabel}
                </span>
                <SegmentControl
                  options={options}
                  value={value}
                  mode="choice"
                  ariaLabel={actionLabel}
                  onChange={(next) =>
                    onActionChange(action.id, next === "none" ? null : next)
                  }
                  disabled={disabled}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}

/**
 * Keep the established tier grammar everywhere except modules whose actions
 * carry independent scopes. Both role defaults and member exceptions render
 * through this switch so the two editors cannot drift.
 */
export function PermissionModuleEditor({
  module,
  edits,
  tier,
  isCustom,
  scope,
  scopeOptions,
  disabled,
  exception,
  onTierChange,
  onScopeChange,
  onActionChange,
  onReset,
}: {
  module: PermissionModule;
  edits: ReadonlyMap<string, PermissionEditState>;
  tier: ModuleTierValue;
  isCustom: boolean;
  scope: PermissionScope;
  scopeOptions: SegmentControlOption<PermissionScope>[];
  disabled?: boolean;
  exception?: ModuleExceptionKind;
  onTierChange: (moduleId: string, tier: ModuleTierValue) => void;
  onScopeChange: (moduleId: string, scope: PermissionScope) => void;
  onActionChange: (permission: string, scope: PermissionScope | null) => void;
  onReset?: (moduleId: string) => void;
}) {
  if (module.editorMode === "action") {
    return (
      <ActionPermissionModule
        module={module}
        edits={edits}
        disabled={disabled}
        exception={exception}
        onActionChange={onActionChange}
        onReset={onReset}
      />
    );
  }

  return (
    <ModulePermissionRow
      moduleId={module.id}
      label={module.label}
      tier={tier}
      isCustom={isCustom}
      scope={scope}
      scopeOptions={scopeOptions}
      disabled={disabled}
      exception={exception}
      onTierChange={onTierChange}
      onScopeChange={onScopeChange}
      onReset={onReset}
    />
  );
}
