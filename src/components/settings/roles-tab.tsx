"use client";

/**
 * Roles & Permissions tab — rebuilt on the shared kit (WEB OVERHAUL P3-6).
 *
 * Two surfaces, one component:
 *   • ROLE LIST  — a `// ROLES` RegisterTable (name / description / members / kebab).
 *     Preset roles carry a lock Tag and are duplicate-to-edit only. One filled-accent
 *     `+ New role` CTA opens the editor in create mode.
 *   • ROLE EDITOR — name + description, then a `// <CATEGORY>` section per permission
 *     category whose module rows each expose a [None | View | Manage | Full]
 *     SegmentControl (the tier is `detectModuleTier`, "Custom" when the enabled mix
 *     maps to no clean tier). Scope-bearing modules get an [All | Assigned | Own]
 *     SegmentControl. Save is dirty-aware; Back prompts a discard dialog when dirty;
 *     preset roles render read-only with a duplicate-to-edit affordance. A compact
 *     `// MEMBERS` sub-section lists role holders with add/remove.
 *
 * Replaces the prior @dnd-kit kanban (palette + tier columns + member-drag board)
 * with bare blue/amber/emerald tier colors and hand-rolled popovers. Tiers are now a
 * SegmentControl value, not a colored column. All behavior, mutations, toasts,
 * preset protection, company-scoped fetch, and member counts are preserved.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { Lock, ArrowLeft, Loader2, X, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type SegmentControlOption } from "@/components/ui/segment-control";
import {
  RegisterTable,
  RegisterEmpty,
  Tag,
  TablePrimary,
  TableMeta,
  TableMono,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { SectionLabel, ModulePermissionRow, type ModuleTierValue } from "./permission-grid";
import {
  useRoles,
  useRolePermissions,
  useRoleMembers,
  useAllUserRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useUpdateRolePermissions,
  useDuplicateRole,
  useAssignUserRole,
  useRemoveUserRole,
  useTeamMembers,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { getUserFullName, getInitials } from "@/lib/types/models";
import {
  PERMISSION_CATEGORIES,
  type PermissionScope,
  type Role,
  getActionsForTier,
  detectModuleTier,
  getPermissionScopes,
} from "@/lib/types/permissions";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";

// ─── Types ───────────────────────────────────────────────────────────────────

type View = "list" | "editor";

/** A per-action edit row mirroring the persisted `role_permissions` shape. */
interface PermissionEdit {
  permission: string;
  scope: PermissionScope;
  enabled: boolean;
}

// ─── Assigned members sub-section ────────────────────────────────────────────

function MemberAvatar({ name }: { name: string }) {
  return (
    <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.18)]">
      <span className="font-mohave text-micro text-text-2">{getInitials(name)}</span>
    </div>
  );
}

function AssignedMembers({
  roleId,
  disabled,
}: {
  roleId: string;
  disabled?: boolean;
}) {
  const { t } = useDictionary("settings");
  const currentUser = useAuthStore((s) => s.currentUser);
  const { data: roleMembers } = useRoleMembers(roleId);
  const { data: teamData } = useTeamMembers();
  const members = teamData?.users ?? [];

  const assignUserRole = useAssignUserRole();
  const removeUserRole = useRemoveUserRole();

  const [pendingAdd, setPendingAdd] = useState<string>("");

  const assignedIds = useMemo(
    () => new Set(roleMembers?.map((m) => m.userId) ?? []),
    [roleMembers],
  );
  const assignedMembers = members.filter((m) => assignedIds.has(m.id));
  const unassignedMembers = members.filter(
    (m) => !assignedIds.has(m.id) && m.isActive !== false,
  );

  function handleAssign(userId: string) {
    if (!currentUser || !userId) return;
    assignUserRole.mutate(
      { userId, roleId, assignedBy: currentUser.id },
      {
        onSuccess: () => {
          toast.success(t("roles.toast.memberAssigned"));
          setPendingAdd("");
        },
        onError: (err) =>
          toast.error(t("roles.toast.assignFailed"), { description: err.message }),
      },
    );
  }

  function handleRemove(userId: string) {
    removeUserRole.mutate(
      { userId, roleId },
      {
        onSuccess: () => toast.success(t("roles.toast.memberRemoved")),
        onError: (err) =>
          toast.error(t("roles.toast.removeFailed"), { description: err.message }),
      },
    );
  }

  return (
    <section aria-label={t("roles.assignedMembers")} className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <SectionLabel>{t("roles.assignedMembers")}</SectionLabel>
        <Tag variant="neutral">{assignedMembers.length}</Tag>
      </div>

      {!disabled && (
        <div className="max-w-[320px]">
          <Select
            value={pendingAdd}
            onValueChange={(v) => handleAssign(v)}
            disabled={unassignedMembers.length === 0}
          >
            <SelectTrigger aria-label={t("roles.addMember")}>
              <SelectValue
                placeholder={
                  unassignedMembers.length === 0
                    ? t("roles.allMembersAssigned")
                    : t("roles.addMemberPlaceholder")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {unassignedMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {getUserFullName(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {assignedMembers.length === 0 ? (
        <p className="font-mono text-micro text-text-3">{t("roles.noMembersAssigned")}</p>
      ) : (
        <div className="glass-surface divide-y divide-border-subtle rounded-panel">
          {assignedMembers.map((m) => {
            const fullName = getUserFullName(m);
            return (
              <div key={m.id} className="flex items-center justify-between gap-1.5 px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <MemberAvatar name={fullName} />
                  <div className="min-w-0">
                    <p className="truncate font-mohave text-body-sm text-text">{fullName}</p>
                    {m.email && (
                      <p className="truncate font-mono text-micro text-text-3">{m.email}</p>
                    )}
                  </div>
                </div>
                {!disabled && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(m.id)}
                    className="shrink-0 gap-1 text-text-3 hover:text-rose"
                  >
                    <X className="h-[14px] w-[14px]" />
                    {t("roles.remove")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Role editor ─────────────────────────────────────────────────────────────

function RoleEditor({
  roleId,
  isCreate,
  onBack,
}: {
  roleId: string;
  isCreate: boolean;
  onBack: () => void;
}) {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data: roles } = useRoles();
  const role = roles?.find((r) => r.id === roleId);
  const { data: permissions, isLoading: permLoading } = useRolePermissions(roleId);

  const updateRole = useUpdateRole();
  const updatePermissions = useUpdateRolePermissions();
  const duplicateRole = useDuplicateRole();

  const isPreset = role?.isPreset ?? false;

  // ── Local state ──────────────────────────────────────────────
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [confirmBack, setConfirmBack] = useState(false);

  // Per-action edit map, seeded once permissions load.
  const [permissionEdits, setPermissionEdits] = useState<Map<string, PermissionEdit>>(
    new Map(),
  );
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (permissions && !initialized) {
      const map = new Map<string, PermissionEdit>();
      for (const cat of PERMISSION_CATEGORIES) {
        for (const mod of cat.modules) {
          for (const action of mod.actions) {
            const existing = permissions.find((p) => p.permission === action.id);
            map.set(action.id, {
              permission: action.id,
              scope: existing?.scope ?? action.scopes[0],
              enabled: !!existing,
            });
          }
        }
      }
      setPermissionEdits(map);
      setInitialized(true);
    }
  }, [permissions, initialized]);

  // ── Derived: enabled permission ids ──────────────────────────
  const enabledIds = useMemo(
    () =>
      Array.from(permissionEdits.entries())
        .filter(([, e]) => e.enabled)
        .map(([id]) => id),
    [permissionEdits],
  );

  // ── Handlers ─────────────────────────────────────────────────

  /**
   * Replace a module's permissions with the chosen tier's action set, each at the
   * module's current scope (clamped to what the action supports). "none" clears them.
   */
  const handleTierChange = useCallback(
    (moduleId: string, tier: ModuleTierValue) => {
      const mod = PERMISSION_CATEGORIES.flatMap((c) => c.modules).find(
        (m) => m.id === moduleId,
      );
      if (!mod) return;

      // The scope the module currently writes (first enabled scope-bearing action).
      const currentScope =
        mod.actions
          .map((a) => permissionEdits.get(a.id))
          .find((e) => e?.enabled && e.scope)?.scope ?? "all";

      const actionIds = tier === "none" ? [] : getActionsForTier(moduleId, tier);

      setPermissionEdits((prev) => {
        const next = new Map(prev);
        for (const action of mod.actions) {
          const existing = next.get(action.id);
          if (!existing) continue;
          const enabled = actionIds.includes(action.id);
          // Clamp the module scope to what this action supports.
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
      for (const cat of PERMISSION_CATEGORIES) {
        for (const mod of cat.modules) {
          if (mod.id !== moduleId) continue;
          for (const action of mod.actions) {
            const existing = next.get(action.id);
            if (existing?.enabled && action.scopes.includes(scope)) {
              next.set(action.id, { ...existing, scope });
            }
          }
        }
      }
      return next;
    });
  }, []);

  // ── Dirty tracking ───────────────────────────────────────────
  const isDirty = useMemo(() => {
    if (!permissions || !initialized) return false;
    if (name !== (role?.name ?? "")) return true;
    if (description !== (role?.description ?? "")) return true;
    for (const [key, edit] of permissionEdits) {
      const existing = permissions.find((p) => p.permission === key);
      if (edit.enabled && !existing) return true;
      if (!edit.enabled && existing) return true;
      if (edit.enabled && existing && edit.scope !== existing.scope) return true;
    }
    return false;
  }, [name, description, permissionEdits, permissions, role, initialized]);

  async function handleSave() {
    if (!role || isPreset) return;
    try {
      if (name !== role.name || description !== (role.description ?? "")) {
        await updateRole.mutateAsync({
          roleId: role.id,
          data: { name: name.trim(), description: description.trim() || null },
        });
      }

      const enabledPerms = Array.from(permissionEdits.values())
        .filter((e) => e.enabled)
        .map((e) => ({ permission: e.permission, scope: e.scope }));

      await updatePermissions.mutateAsync({ roleId: role.id, permissions: enabledPerms });
      toast.success(t("roles.toast.saved"));
    } catch (err) {
      toast.error(t("roles.toast.saveFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  function handleBack() {
    if (isDirty) setConfirmBack(true);
    else onBack();
  }

  function handleDuplicate() {
    if (!role) return;
    duplicateRole.mutate(
      { sourceRoleId: role.id, companyId, newName: `${role.name} (Copy)` },
      {
        onSuccess: () => {
          toast.success(t("roles.toast.duplicated"));
          onBack();
        },
        onError: (err) =>
          toast.error(t("roles.toast.duplicateFailed"), { description: err.message }),
      },
    );
  }

  if (permLoading || !role) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-[20px] w-[20px] animate-spin text-text-2 motion-reduce:animate-none" />
      </div>
    );
  }

  const headerLabel = isCreate ? t("roles.newRoleTitle") : t("roles.editRoleTitle");

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-1 font-mono text-micro uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text"
        >
          <ArrowLeft className="h-[14px] w-[14px]" />
          {t("roles.back")}
        </button>
        <div className="flex items-center gap-1.5">
          {isDirty && !isPreset && (
            <span className="font-mono text-micro uppercase tracking-[0.12em] text-tan">
              [{t("roles.unsaved")}]
            </span>
          )}
          {isPreset ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleDuplicate}
              disabled={duplicateRole.isPending}
              loading={duplicateRole.isPending}
            >
              {t("roles.duplicateToEdit")}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || updatePermissions.isPending || updateRole.isPending}
              loading={updatePermissions.isPending || updateRole.isPending}
            >
              {t("roles.saveChanges")}
            </Button>
          )}
        </div>
      </div>

      <SectionLabel>{headerLabel}</SectionLabel>

      {/* Preset read-only note */}
      {isPreset && (
        <div className="glass-surface flex items-center gap-1.5 rounded-panel px-2 py-1.5">
          <Lock className="h-[14px] w-[14px] shrink-0 text-tan" />
          <p className="font-mono text-micro text-tan">{t("roles.presetBanner")}</p>
        </div>
      )}

      {/* Identity */}
      <div className="glass-surface space-y-2 rounded-panel p-2">
        <Input
          label={t("roles.nameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPreset}
          placeholder={t("roles.namePlaceholder")}
        />
        <Textarea
          label={t("roles.descriptionLabel")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isPreset}
          placeholder={t("roles.descriptionPlaceholder")}
          rows={2}
        />
      </div>

      {/* Permissions, grouped by category */}
      <div className="space-y-3">
        {PERMISSION_CATEGORIES.map((category) => (
          <section key={category.id} className="space-y-1.5" aria-label={category.label}>
            <SectionLabel>{category.label}</SectionLabel>
            <div className="glass-surface rounded-panel px-2">
              {category.modules.map((mod) => {
                const detected = detectModuleTier(mod.id, enabledIds);
                const hasAny = mod.actions.some((a) => permissionEdits.get(a.id)?.enabled);
                const isCustom = detected === null && hasAny;
                const tier: ModuleTierValue = detected ?? "none";

                // Scope segments the module's actions actually offer.
                const availableScopes = Array.from(
                  new Set(mod.actions.flatMap((a) => a.scopes)),
                ) as PermissionScope[];
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
                  mod.actions
                    .map((a) => permissionEdits.get(a.id))
                    .find((e) => e?.enabled && e.scope)?.scope ?? "all";

                return (
                  <ModulePermissionRow
                    key={mod.id}
                    moduleId={mod.id}
                    label={mod.label}
                    tier={tier}
                    isCustom={isCustom}
                    scope={currentScope}
                    scopeOptions={scopeOptions}
                    disabled={isPreset}
                    onTierChange={handleTierChange}
                    onScopeChange={handleScopeChange}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Members */}
      <AssignedMembers roleId={roleId} disabled={isPreset} />

      {/* Discard confirmation */}
      <ConfirmDialog
        open={confirmBack}
        onOpenChange={setConfirmBack}
        title={t("roles.discardTitle")}
        description={t("roles.discardDescription")}
        confirmLabel={t("roles.discard")}
        variant="destructive"
        onConfirm={onBack}
      />
    </div>
  );
}

// ─── Role list ───────────────────────────────────────────────────────────────

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isPreset: boolean;
  memberCount: number;
}

function RoleKebab({
  role,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  role: RoleRow;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useDictionary("settings");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("roles.actions")}
          onClick={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded text-text-3 transition-colors hover:bg-surface-hover hover:text-text"
        >
          <MoreHorizontal className="h-[16px] w-[16px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!role.isPreset && (
          <DropdownMenuItem onSelect={onEdit}>{t("roles.edit")}</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onDuplicate}>{t("roles.duplicate")}</DropdownMenuItem>
        {!role.isPreset && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-rose focus:text-rose"
            >
              {t("roles.deleteRole")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Main tab ────────────────────────────────────────────────────────────────

export function RolesTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data: roles, isLoading } = useRoles();
  const { data: allUserRoles } = useAllUserRoles();
  const createRole = useCreateRole();
  const duplicateRole = useDuplicateRole();
  const deleteRole = useDeleteRole();

  const [view, setView] = useState<View>("list");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editIsCreate, setEditIsCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Member counts per role.
  const memberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ur of allUserRoles ?? []) {
      counts.set(ur.roleId, (counts.get(ur.roleId) ?? 0) + 1);
    }
    return counts;
  }, [allUserRoles]);

  const toRow = useCallback(
    (r: Role): RoleRow => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isPreset: r.isPreset,
      memberCount: memberCounts.get(r.id) ?? 0,
    }),
    [memberCounts],
  );

  const presetRows = useMemo(
    () => (roles ?? []).filter((r) => r.isPreset).map(toRow),
    [roles, toRow],
  );
  const customRows = useMemo(
    () => (roles ?? []).filter((r) => !r.isPreset).map(toRow),
    [roles, toRow],
  );

  function openEditor(roleId: string, create: boolean) {
    setSelectedRoleId(roleId);
    setEditIsCreate(create);
    setView("editor");
  }

  function closeEditor() {
    setView("list");
    setSelectedRoleId(null);
    setEditIsCreate(false);
  }

  function handleCreate() {
    createRole.mutate(
      {
        name: t("roles.newRoleDefaultName"),
        description: null,
        companyId,
        hierarchy: 5,
      },
      {
        onSuccess: (role) => {
          toast.success(t("roles.toast.created"));
          openEditor(role.id, true);
        },
        onError: (err) =>
          toast.error(t("roles.toast.createFailed"), { description: err.message }),
      },
    );
  }

  function handleDuplicate(role: RoleRow) {
    duplicateRole.mutate(
      { sourceRoleId: role.id, companyId, newName: `${role.name} (Copy)` },
      {
        onSuccess: () => toast.success(t("roles.toast.duplicated")),
        onError: (err) =>
          toast.error(t("roles.toast.duplicateFailed"), { description: err.message }),
      },
    );
  }

  function handleDelete(roleId: string) {
    deleteRole.mutate(roleId, {
      onSuccess: () => {
        toast.success(t("roles.toast.deleted"));
        setConfirmDelete(null);
      },
      onError: (err) =>
        toast.error(t("roles.toast.deleteFailed"), { description: err.message }),
    });
  }

  // ── Editor view ──────────────────────────────────────────────
  if (view === "editor" && selectedRoleId) {
    return (
      <RoleEditor roleId={selectedRoleId} isCreate={editIsCreate} onBack={closeEditor} />
    );
  }

  // ── List view ────────────────────────────────────────────────
  const columns: RegisterTableColumn<RoleRow>[] = [
    {
      id: "name",
      header: t("roles.colName"),
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <TablePrimary>{r.name}</TablePrimary>
          {r.isPreset && (
            <Tag variant="dim" className="gap-1">
              <Lock className="h-[10px] w-[10px]" />
              {t("roles.presetTag")}
            </Tag>
          )}
        </div>
      ),
    },
    {
      id: "description",
      header: t("roles.descriptionLabel"),
      cell: (r) =>
        r.description ? (
          <TableMeta className="max-w-[320px]">{r.description}</TableMeta>
        ) : (
          <span className="font-mono text-data-sm text-text-mute">—</span>
        ),
      className: "hidden md:table-cell",
    },
    {
      id: "members",
      header: t("roles.colMembers"),
      align: "right",
      cell: (r) => <TableMono>{r.memberCount}</TableMono>,
      className: "w-[120px]",
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <RoleKebab
          role={r}
          onEdit={() => openEditor(r.id, false)}
          onDuplicate={() => handleDuplicate(r)}
          onDelete={() => setConfirmDelete(r.id)}
        />
      ),
      className: "w-[56px]",
    },
  ];

  return (
    <div className="space-y-3">
      {/* Header: title + primary CTA */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <SectionLabel>{t("roles.title")}</SectionLabel>
          <p className="max-w-[520px] font-mono text-micro text-text-3">
            {t("roles.subtitle")}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={handleCreate}
          disabled={createRole.isPending}
          loading={createRole.isPending}
        >
          {t("roles.newRole")}
        </Button>
      </div>

      {isLoading ? (
        <div className="glass-surface flex items-center justify-center py-8">
          <Loader2 className="h-[18px] w-[18px] animate-spin text-text-2 motion-reduce:animate-none" />
        </div>
      ) : (
        <>
          {/* Preset roles */}
          <section aria-label={t("roles.presets")} className="space-y-1.5">
            <SectionLabel>{t("roles.presets")}</SectionLabel>
            <RegisterTable
              ariaLabel={t("roles.presets")}
              columns={columns}
              rows={presetRows}
              getRowId={(r) => r.id}
              onRowClick={(r) => openEditor(r.id, false)}
              minWidth={620}
            />
          </section>

          {/* Custom roles */}
          <section aria-label={t("roles.customRoles")} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <SectionLabel>{t("roles.customRoles")}</SectionLabel>
              <Tag variant="neutral">{customRows.length}</Tag>
            </div>
            {customRows.length === 0 ? (
              <div className="glass-surface rounded-panel">
                <RegisterEmpty noun={t("roles.customRoles")} hint={t("roles.noCustomRoles")} />
              </div>
            ) : (
              <RegisterTable
                ariaLabel={t("roles.customRoles")}
                columns={columns}
                rows={customRows}
                getRowId={(r) => r.id}
                onRowClick={(r) => openEditor(r.id, false)}
                minWidth={620}
              />
            )}
          </section>
        </>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={t("roles.deleteConfirmTitle")}
        description={t("roles.deleteConfirmDescription")}
        confirmLabel={t("roles.delete")}
        variant="destructive"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        loading={deleteRole.isPending}
      />
    </div>
  );
}
