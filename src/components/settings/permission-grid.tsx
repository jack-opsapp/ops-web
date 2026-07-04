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
import { Tag } from "@/components/ui/register-table";
import { SegmentControl, type SegmentControlOption } from "@/components/ui/segment-control";
import type { PermissionScope, PermissionTier } from "@/lib/types/permissions";
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
