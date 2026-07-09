"use client";

/**
 * MemberAccessView — SETTINGS › TEAM › member access (BUG BURNDOWN W5).
 *
 * The anchor surface for per-member permission exceptions. Answers one
 * question for a trades owner: "what can THIS person do?" — showing the
 * member's EFFECTIVE access (role grants ∪ exceptions), with every deviation
 * from their role marked and one click from being undone.
 *
 *   • Role is the baseline (a member picks one, changes rarely) → a compact
 *     chip picker that applies immediately.
 *   • Exceptions are surgical deviations layered on top → the // ACCESS grid,
 *     category-collapsed, exceptions surfaced with a tag + reset.
 *
 * Bypass admins (account holder / admin_ids / is_company_admin) hold
 * everything by definition; the grid is replaced with a FULL ACCESS state.
 * Reads work under the new company-scoped RLS; writes go through the guarded
 * override + role routes (see roles-service / permission-overrides-service).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/register-table";
import { UserAvatar } from "@/components/ops/user-avatar";
import { AssignRoleModalSeatBanner } from "@/components/ops/assign-role-modal-seat-banner";
import type { SegmentControlOption } from "@/components/ui/segment-control";
import { SectionLabel, ModulePermissionRow, type ModuleTierValue, type ModuleExceptionKind } from "./permission-grid";
import {
  useTeamMembers,
  useCompany,
  useRoles,
  useAllUserRoles,
  useAddSeatedEmployee,
} from "@/lib/hooks";
import { useMemberAccess, useSaveMemberAccess } from "@/lib/hooks/use-member-access";
import { useAssignMemberRole } from "@/lib/hooks/use-assign-member-role";
import { getUserFullName } from "@/lib/types/models";
import {
  PERMISSION_CATEGORIES,
  type PermissionScope,
  getActionsForTier,
  detectModuleTier,
  getPermissionScopes,
  getModuleForPermission,
} from "@/lib/types/permissions";
import {
  roleGrantMap,
  resolveEffectivePermissions,
  diffAgainstRole,
  classifyExceptions,
  computeOverrideMutation,
  isAdminBypass,
  type MemberException,
} from "@/lib/permissions/resolve";
import { useDictionary } from "@/i18n/client";
import { toast } from "@/components/ui/toast";

interface PermissionEdit {
  permission: string;
  scope: PermissionScope;
  enabled: boolean;
}

/** Reduce a module's per-action exception kinds to one label for the tag. */
function moduleExceptionKind(kinds: MemberException["kind"][]): ModuleExceptionKind | undefined {
  if (kinds.length === 0) return undefined;
  const unique = Array.from(new Set(kinds));
  return unique.length === 1 ? unique[0] : "mixed";
}

export function MemberAccessView({
  memberId,
  onBack,
}: {
  memberId: string;
  onBack: () => void;
}) {
  const { t } = useDictionary("settings");

  const { data: teamData } = useTeamMembers();
  const { data: company } = useCompany();
  const { data: roles } = useRoles();
  const { data: allUserRoles } = useAllUserRoles();
  const { data: access, isLoading } = useMemberAccess(memberId);

  const saveAccess = useSaveMemberAccess();
  const assignRole = useAssignMemberRole();
  const addSeat = useAddSeatedEmployee();

  const member = useMemo(
    () => (teamData?.users ?? []).find((u) => u.id === memberId),
    [teamData, memberId],
  );

  const memberIsAdmin = useMemo(
    () =>
      isAdminBypass(
        { id: memberId, isCompanyAdmin: member?.isCompanyAdmin },
        company
          ? { accountHolderId: company.accountHolderId, adminIds: company.adminIds }
          : null,
      ),
    [memberId, member, company],
  );

  const seatedIds = company?.seatedEmployeeIds ?? [];
  const maxSeats = company?.maxSeats ?? 0;
  const isSeated = seatedIds.includes(memberId);
  const seatsAvailable = Math.max(0, maxSeats - seatedIds.length);
  const isActive = member?.isActive !== false;

  // Current role_id from user_roles (authoritative — not legacy users.role).
  const currentRoleId = useMemo(
    () => allUserRoles?.find((ur) => ur.userId === memberId)?.roleId ?? access?.roleId ?? null,
    [allUserRoles, memberId, access],
  );

  const rolePermissions = useMemo(() => access?.rolePermissions ?? [], [access]);
  const overrides = useMemo(() => access?.overrides ?? [], [access]);

  // ── Per-action edit map, seeded from the member's EFFECTIVE access ──────────
  const [permissionEdits, setPermissionEdits] = useState<Map<string, PermissionEdit>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seedKey = useRef<string>("");

  useEffect(() => {
    if (!access) return;
    // Re-seed only when the underlying server truth changes (role swap, saved
    // exceptions) — never mid-edit, since local edits don't touch server data.
    const key = JSON.stringify([
      access.roleId,
      [...access.rolePermissions].map((p) => `${p.permission}:${p.scope}`).sort(),
      [...access.overrides].map((o) => `${o.permission}:${o.scope}:${o.granted}`).sort(),
    ]);
    if (key === seedKey.current) return;
    seedKey.current = key;

    const effective = resolveEffectivePermissions(access.rolePermissions, access.overrides);
    const map = new Map<string, PermissionEdit>();
    for (const cat of PERMISSION_CATEGORIES) {
      for (const mod of cat.modules) {
        for (const action of mod.actions) {
          const scope = effective.get(action.id);
          map.set(action.id, {
            permission: action.id,
            scope: scope ?? action.scopes[0],
            enabled: effective.has(action.id),
          });
        }
      }
    }
    setPermissionEdits(map);

    // Expand categories that already carry an exception so the manager lands
    // on the member's real deviations, not a wall of collapsed sections.
    const exc = classifyExceptions(access.rolePermissions, access.overrides);
    const excCats = new Set<string>();
    for (const e of exc) {
      const moduleId = getModuleForPermission(e.permission);
      const cat = PERMISSION_CATEGORIES.find((c) => c.modules.some((m) => m.id === moduleId));
      if (cat) excCats.add(cat.id);
    }
    setExpanded(excCats);
  }, [access]);

  // ── Derived: desired state, role baseline, live diff, exceptions ────────────
  const roleMap = useMemo(() => roleGrantMap(rolePermissions), [rolePermissions]);

  const desired = useMemo(() => {
    const map = new Map<string, PermissionScope | null>();
    for (const [id, edit] of permissionEdits) {
      map.set(id, edit.enabled ? edit.scope : null);
    }
    return map;
  }, [permissionEdits]);

  const diff = useMemo(() => diffAgainstRole(rolePermissions, desired), [rolePermissions, desired]);

  const mutation = useMemo(
    () => computeOverrideMutation(overrides, diff),
    [overrides, diff],
  );
  const isDirty = mutation.hasChanges;

  // Live pending exceptions (from the current grid, not yet saved), grouped by module.
  const exceptionsByModule = useMemo(() => {
    const pending = classifyExceptions(
      rolePermissions,
      diff.set.map((s) => ({ permission: s.permission, scope: s.scope, granted: s.granted })),
    );
    const byModule = new Map<string, MemberException["kind"][]>();
    for (const e of pending) {
      const moduleId = getModuleForPermission(e.permission);
      if (!moduleId) continue;
      const list = byModule.get(moduleId) ?? [];
      list.push(e.kind);
      byModule.set(moduleId, list);
    }
    return byModule;
  }, [rolePermissions, diff.set]);

  const totalExceptions = useMemo(
    () => Array.from(exceptionsByModule.values()).reduce((n, k) => n + k.length, 0),
    [exceptionsByModule],
  );

  const enabledIds = useMemo(
    () => Array.from(permissionEdits.values()).filter((e) => e.enabled).map((e) => e.permission),
    [permissionEdits],
  );

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleTierChange = useCallback(
    (moduleId: string, tier: ModuleTierValue) => {
      const mod = PERMISSION_CATEGORIES.flatMap((c) => c.modules).find((m) => m.id === moduleId);
      if (!mod) return;
      const currentScope =
        mod.actions.map((a) => permissionEdits.get(a.id)).find((e) => e?.enabled && e.scope)?.scope ?? "all";
      const actionIds = tier === "none" ? [] : getActionsForTier(moduleId, tier);
      setPermissionEdits((prev) => {
        const next = new Map(prev);
        for (const action of mod.actions) {
          const existing = next.get(action.id);
          if (!existing) continue;
          const enabled = actionIds.includes(action.id);
          const supported = getPermissionScopes(action.id);
          const scope = supported.includes(currentScope) ? currentScope : supported[0];
          next.set(action.id, { ...existing, enabled, scope });
        }
        return next;
      });
    },
    [permissionEdits],
  );

  const handleScopeChange = useCallback((moduleId: string, scope: PermissionScope) => {
    setPermissionEdits((prev) => {
      const next = new Map(prev);
      const mod = PERMISSION_CATEGORIES.flatMap((c) => c.modules).find((m) => m.id === moduleId);
      if (!mod) return prev;
      for (const action of mod.actions) {
        const existing = next.get(action.id);
        if (existing?.enabled && action.scopes.includes(scope)) {
          next.set(action.id, { ...existing, scope });
        }
      }
      return next;
    });
  }, []);

  // Return a module to its role default (clear its exceptions).
  const handleResetModule = useCallback(
    (moduleId: string) => {
      const mod = PERMISSION_CATEGORIES.flatMap((c) => c.modules).find((m) => m.id === moduleId);
      if (!mod) return;
      setPermissionEdits((prev) => {
        const next = new Map(prev);
        for (const action of mod.actions) {
          const existing = next.get(action.id);
          if (!existing) continue;
          const roleScope = roleMap.get(action.id) ?? null;
          next.set(action.id, {
            ...existing,
            enabled: roleScope !== null,
            scope: roleScope ?? existing.scope,
          });
        }
        return next;
      });
    },
    [roleMap],
  );

  const handleResetAll = useCallback(() => {
    setPermissionEdits((prev) => {
      const next = new Map(prev);
      for (const [id, edit] of prev) {
        const roleScope = roleMap.get(id) ?? null;
        next.set(id, { ...edit, enabled: roleScope !== null, scope: roleScope ?? edit.scope });
      }
      return next;
    });
  }, [roleMap]);

  function handleRoleChange(roleId: string) {
    if (isDirty || roleId === currentRoleId) return;
    assignRole.mutate(
      { userId: memberId, roleId },
      {
        onSuccess: (result) => toast.success(`${t("team.access.roleSet")} ${result.roleName}`),
        onError: (err) => toast.error(t("team.access.roleSetFailed"), { description: err.message }),
      },
    );
  }

  function handleSeat() {
    addSeat.mutate(memberId, {
      onSuccess: () => toast.success(t("team.toast.seatAssigned")),
      onError: (err) => toast.error(t("team.toast.seatAssignFailed"), { description: err.message }),
    });
  }

  function handleSave() {
    saveAccess.mutate(
      { userId: memberId, diff: { set: mutation.set, clear: mutation.clear } },
      {
        onSuccess: () => toast.success(t("team.access.saved")),
        onError: (err) => toast.error(t("team.access.saveFailed"), { description: err.message }),
      },
    );
  }

  // ── Header (shared by every state) ──────────────────────────────────────────
  const fullName = member ? getUserFullName(member) : "";
  const roleName = roles?.find((r) => r.id === currentRoleId)?.name ?? access?.roleName ?? null;

  const header = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 font-mono text-micro uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text"
      >
        <ArrowLeft className="h-[14px] w-[14px]" />
        {t("team.access.back")}
      </button>
      {!memberIsAdmin && isActive && (
        <div className="flex items-center gap-1.5">
          {isDirty && (
            <span className="font-mono text-micro uppercase tracking-[0.12em] text-tan">
              [{t("team.access.unsaved")}]
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || saveAccess.isPending}
            loading={saveAccess.isPending}
          >
            {t("team.access.save")}
          </Button>
        </div>
      )}
    </div>
  );

  const identity = member && (
    <div className="glass-surface flex items-center gap-2 rounded-panel p-2">
      <UserAvatar name={fullName} imageUrl={member.profileImageURL} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mohave text-body-lg text-text">{fullName}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {member.email && (
            <a href={`mailto:${member.email}`} className="truncate font-mono text-micro text-text-3 transition-colors hover:text-text">
              {member.email}
            </a>
          )}
          {member.phone && (
            <a href={`tel:${member.phone}`} className="font-mono text-micro text-text-3 transition-colors hover:text-text">
              {member.phone}
            </a>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isSeated ? <Tag variant="olive">{t("team.seated")}</Tag> : <Tag variant="dim">{t("team.unseated")}</Tag>}
        {memberIsAdmin ? (
          <Tag variant="neutral">
            <ShieldCheck className="h-[11px] w-[11px]" />
            {t("team.roleAdmin")}
          </Tag>
        ) : (
          roleName && <Tag variant="neutral">{roleName}</Tag>
        )}
      </div>
    </div>
  );

  if (isLoading || !member) {
    return (
      <div className="space-y-3">
        {header}
        <div className="glass-surface flex items-center justify-center py-8">
          <Loader2 className="h-[20px] w-[20px] animate-spin text-text-2 motion-reduce:animate-none" />
        </div>
      </div>
    );
  }

  // ── Bypass-admin target: no exceptions possible ─────────────────────────────
  if (memberIsAdmin) {
    return (
      <div className="space-y-3">
        {header}
        {identity}
        <div className="glass-surface flex items-start gap-2 rounded-panel p-3">
          <ShieldCheck className="mt-0.5 h-[16px] w-[16px] shrink-0 text-text-2" />
          <div>
            <p className="font-cakemono text-body font-light uppercase tracking-[0.06em] text-text">
              {t("team.access.fullAccessTitle")}
            </p>
            <p className="mt-1 max-w-[420px] font-mono text-micro leading-relaxed text-text-3">
              {t("team.access.fullAccessBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const roleChangeLocked = isDirty;

  return (
    <div className="space-y-3">
      {header}
      {identity}

      {/* Unseated members can hold a role, but it only takes effect once seated. */}
      {!isSeated && isActive && (
        <AssignRoleModalSeatBanner
          firstName={member.firstName ?? fullName}
          isSeated={isSeated}
          seatsAvailable={seatsAvailable}
          onAssignSeat={handleSeat}
          onManageSeats={onBack}
          isAssigning={addSeat.isPending}
        />
      )}

      {/* ── // ROLE ──────────────────────────────────────────────────────────── */}
      <section aria-label={t("team.access.roleTitle")} className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <SectionLabel>{t("team.access.roleTitle")}</SectionLabel>
          {roleChangeLocked && (
            <span className="font-mono text-micro text-text-mute">[{t("team.access.roleLocked")}]</span>
          )}
        </div>
        <div className="glass-surface rounded-panel p-2">
          <div className="flex flex-wrap items-center gap-1">
            {(roles ?? [])
              // SPEC Operator (hierarchy 0) is the internal ops-console gate,
              // never a company-assignable role.
              .filter((role) => role.hierarchy >= 1)
              .map((role) => {
              const active = role.id === currentRoleId;
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => handleRoleChange(role.id)}
                  disabled={roleChangeLocked || assignRole.isPending}
                  className={cn(
                    "rounded border px-1.5 py-[6px] font-mohave text-body-sm transition-colors duration-150",
                    active
                      ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                      : "border-border bg-surface-input text-text-3 hover:text-text-2",
                    (roleChangeLocked || assignRole.isPending) && !active && "pointer-events-none opacity-40",
                  )}
                >
                  {role.name}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── // ACCESS ────────────────────────────────────────────────────────── */}
      <section aria-label={t("team.access.accessTitle")} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <SectionLabel>{t("team.access.accessTitle")}</SectionLabel>
            {totalExceptions > 0 && (
              <Tag variant="tan">
                {totalExceptions} {totalExceptions === 1 ? t("team.access.exceptionOne") : t("team.access.exceptionMany")}
              </Tag>
            )}
          </div>
          {totalExceptions > 0 && (
            <button
              type="button"
              onClick={handleResetAll}
              className="font-mono text-micro uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text"
            >
              {t("team.access.resetAll")}
            </button>
          )}
        </div>

        {totalExceptions === 0 && (
          <p className="font-mono text-micro text-text-3">
            {roleName ? `${t("team.access.matchesRolePrefix")} ${roleName}.` : t("team.access.noRole")}
          </p>
        )}

        <div className="space-y-2">
          {PERMISSION_CATEGORIES.map((category) => {
            const catExceptions = category.modules.reduce(
              (n, m) => n + (exceptionsByModule.get(m.id)?.length ?? 0),
              0,
            );
            const isOpen = expanded.has(category.id);
            return (
              <div key={category.id} className="glass-surface rounded-panel">
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(category.id)) next.delete(category.id);
                      else next.add(category.id);
                      return next;
                    })
                  }
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left"
                >
                  <SectionLabel>{category.label}</SectionLabel>
                  <div className="flex items-center gap-1.5">
                    {catExceptions > 0 && <Tag variant="tan">{catExceptions}</Tag>}
                    <span className="font-mono text-micro text-text-mute">{isOpen ? "−" : "+"}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border-subtle px-2 pb-1">
                    {category.modules.map((mod) => {
                      const detected = detectModuleTier(mod.id, enabledIds);
                      const hasAny = mod.actions.some((a) => permissionEdits.get(a.id)?.enabled);
                      const isCustom = detected === null && hasAny;
                      const tier: ModuleTierValue = detected ?? "none";

                      const availableScopes = Array.from(new Set(mod.actions.flatMap((a) => a.scopes))) as PermissionScope[];
                      const scopeOptions: SegmentControlOption<PermissionScope>[] =
                        availableScopes.length > 1
                          ? availableScopes.map((s) => ({
                              value: s,
                              label:
                                s === "all"
                                  ? t("roles.scopeAll")
                                  : s === "assigned"
                                    ? t("roles.scopeAssignedOnly")
                                    : t("roles.scopeOwn"),
                            }))
                          : [];
                      const currentScope =
                        mod.actions.map((a) => permissionEdits.get(a.id)).find((e) => e?.enabled && e.scope)?.scope ?? "all";

                      const exception = moduleExceptionKind(exceptionsByModule.get(mod.id) ?? []);

                      return (
                        <ModulePermissionRow
                          key={mod.id}
                          moduleId={mod.id}
                          label={mod.label}
                          tier={tier}
                          isCustom={isCustom}
                          scope={currentScope}
                          scopeOptions={scopeOptions}
                          disabled={!isActive}
                          exception={exception}
                          onTierChange={handleTierChange}
                          onScopeChange={handleScopeChange}
                          onReset={handleResetModule}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
