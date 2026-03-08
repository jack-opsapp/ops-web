"use client";

import { useState, useMemo, useCallback, useEffect, Fragment } from "react";
import {
  Lock,
  Copy,
  Plus,
  ChevronRight,
  Search,
  X,
  Trash2,
  ArrowLeft,
  MoreHorizontal,
  Loader2,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
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
  type RolePermission,
} from "@/lib/types/permissions";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Types ───────────────────────────────────────────────────────────────────

type View = "list" | "editor";

interface PermissionEdit {
  permission: string;
  scope: PermissionScope;
  enabled: boolean;
}

// ─── Scope Segmented Control ─────────────────────────────────────────────────

function ScopeSelector({
  scopes,
  value,
  onChange,
  disabled,
}: {
  scopes: PermissionScope[];
  value: PermissionScope;
  onChange: (scope: PermissionScope) => void;
  disabled?: boolean;
}) {
  if (scopes.length <= 1) return null;

  return (
    <div className="flex items-center gap-0 animate-fade-in">
      {scopes.map((scope) => (
        <button
          key={scope}
          type="button"
          disabled={disabled}
          onClick={() => onChange(scope)}
          className={cn(
            "px-[8px] py-[3px] font-kosugi text-[10px] uppercase tracking-wider",
            "border transition-colors duration-150",
            "first:rounded-l last:rounded-r",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            value === scope
              ? "bg-ops-accent-muted text-ops-accent border-ops-accent"
              : "bg-transparent text-text-disabled border-border hover:text-text-tertiary"
          )}
        >
          {scope}
        </button>
      ))}
    </div>
  );
}

// ─── Permission Row ──────────────────────────────────────────────────────────

function PermissionRow({
  actionId,
  label,
  scopes,
  enabled,
  scope,
  onToggle,
  onScopeChange,
  disabled,
  searchQuery,
}: {
  actionId: string;
  label: string;
  scopes: PermissionScope[];
  enabled: boolean;
  scope: PermissionScope;
  onToggle: (enabled: boolean) => void;
  onScopeChange: (scope: PermissionScope) => void;
  disabled?: boolean;
  searchQuery?: string;
}) {
  // Highlight matching text
  const renderedLabel = useMemo(() => {
    if (!searchQuery) return label;
    const idx = label.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return label;
    return (
      <>
        {label.slice(0, idx)}
        <span className="bg-ops-accent-muted rounded-sm px-[2px]">
          {label.slice(idx, idx + searchQuery.length)}
        </span>
        {label.slice(idx + searchQuery.length)}
      </>
    );
  }, [label, searchQuery]);

  return (
    <div className="flex items-center justify-between py-[6px] border-b border-[rgba(255,255,255,0.04)] last:border-0">
      <span className="font-kosugi text-caption text-text-secondary flex-1 min-w-0">
        {renderedLabel}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        {enabled && scopes.length > 1 && (
          <ScopeSelector
            scopes={scopes}
            value={scope}
            onChange={onScopeChange}
            disabled={disabled}
          />
        )}
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// ─── Module Accordion ────────────────────────────────────────────────────────

function ModuleAccordion({
  module,
  permissionEdits,
  onToggle,
  onScopeChange,
  disabled,
  searchQuery,
  forceExpanded,
}: {
  module: (typeof PERMISSION_CATEGORIES)[number]["modules"][number];
  permissionEdits: Map<string, PermissionEdit>;
  onToggle: (permission: string, enabled: boolean) => void;
  onScopeChange: (permission: string, scope: PermissionScope) => void;
  disabled?: boolean;
  searchQuery?: string;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = forceExpanded || expanded;

  const enabledCount = module.actions.filter(
    (a) => permissionEdits.get(a.id)?.enabled
  ).length;
  const totalCount = module.actions.length;
  const allEnabled = enabledCount === totalCount;

  return (
    <div className="border-b border-[rgba(255,255,255,0.06)] last:border-0">
      <button
        type="button"
        onClick={() => setExpanded(!isExpanded)}
        className="w-full flex items-center justify-between py-[10px] group"
      >
        <div className="flex items-center gap-[6px]">
          <ChevronRight
            className={cn(
              "w-[14px] h-[14px] text-text-disabled transition-transform duration-200",
              isExpanded && "rotate-90"
            )}
          />
          <span className="font-mohave text-body-sm uppercase text-text-primary">
            {module.label}
          </span>
        </div>
        <span
          className={cn(
            "font-mono text-[10px]",
            allEnabled ? "text-ops-accent" : "text-text-disabled"
          )}
        >
          {enabledCount} of {totalCount}
        </span>
      </button>

      {isExpanded && (
        <div className="pl-[20px] pb-[8px] animate-accordion-down">
          {module.actions.map((action) => {
            const edit = permissionEdits.get(action.id);
            return (
              <PermissionRow
                key={action.id}
                actionId={action.id}
                label={action.label}
                scopes={action.scopes}
                enabled={edit?.enabled ?? false}
                scope={edit?.scope ?? "all"}
                onToggle={(enabled) => onToggle(action.id, enabled)}
                onScopeChange={(scope) => onScopeChange(action.id, scope)}
                disabled={disabled}
                searchQuery={searchQuery}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Role Editor ─────────────────────────────────────────────────────────────

function RoleEditor({
  roleId,
  onBack,
}: {
  roleId: string;
  onBack: () => void;
}) {
  const { t } = useDictionary("settings");
  const currentUser = useAuthStore((s) => s.currentUser);
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data: roles } = useRoles();
  const role = roles?.find((r) => r.id === roleId);
  const { data: permissions, isLoading: permLoading } = useRolePermissions(roleId);
  const { data: roleMembers } = useRoleMembers(roleId);
  const { data: teamData } = useTeamMembers();
  const members = teamData?.users ?? [];

  const updateRole = useUpdateRole();
  const updatePermissions = useUpdateRolePermissions();
  const duplicateRole = useDuplicateRole();
  const assignUserRole = useAssignUserRole();
  const removeUserRole = useRemoveUserRole();

  const isPreset = role?.isPreset ?? false;

  // ── Local state ──────────────────────────────────────────────
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);

  // Build permission edits from fetched data
  const [permissionEdits, setPermissionEdits] = useState<Map<string, PermissionEdit>>(new Map());
  const [initializedPerms, setInitializedPerms] = useState(false);

  // Initialize permission edits once data loads
  useEffect(() => {
    if (permissions && !initializedPerms) {
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
      setInitializedPerms(true);
    }
  }, [permissions, initializedPerms]);

  // Track dirty state
  const isDirty = useMemo(() => {
    if (!permissions || !initializedPerms) return false;
    // Check name/description changes
    if (name !== (role?.name ?? "")) return true;
    if (description !== (role?.description ?? "")) return true;
    // Check permission changes
    for (const [key, edit] of permissionEdits) {
      const existing = permissions.find((p) => p.permission === key);
      if (edit.enabled && !existing) return true;
      if (!edit.enabled && existing) return true;
      if (edit.enabled && existing && edit.scope !== existing.scope) return true;
    }
    return false;
  }, [name, description, permissionEdits, permissions, role, initializedPerms]);

  // ── Handlers ─────────────────────────────────────────────────

  function handleToggle(permission: string, enabled: boolean) {
    setPermissionEdits((prev) => {
      const next = new Map(prev);
      const existing = next.get(permission);
      if (existing) {
        next.set(permission, { ...existing, enabled });
      }
      return next;
    });
  }

  function handleScopeChange(permission: string, scope: PermissionScope) {
    setPermissionEdits((prev) => {
      const next = new Map(prev);
      const existing = next.get(permission);
      if (existing) {
        next.set(permission, { ...existing, scope });
      }
      return next;
    });
  }

  async function handleSave() {
    if (!role || isPreset) return;

    try {
      // Update role name/description if changed
      if (name !== role.name || description !== role.description) {
        await updateRole.mutateAsync({
          roleId: role.id,
          data: { name: name.trim(), description: description.trim() || null },
        });
      }

      // Update permissions
      const enabledPerms = Array.from(permissionEdits.values())
        .filter((e) => e.enabled)
        .map((e) => ({ permission: e.permission, scope: e.scope }));

      await updatePermissions.mutateAsync({
        roleId: role.id,
        permissions: enabledPerms,
      });

      toast.success(t("roles.toast.saved"));
    } catch (err) {
      toast.error(t("roles.toast.saveFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  function handleBack() {
    if (isDirty) {
      setConfirmBack(true);
    } else {
      onBack();
    }
  }

  function handleDuplicate() {
    if (!role) return;
    duplicateRole.mutate(
      {
        sourceRoleId: role.id,
        companyId,
        newName: `${role.name} (Copy)`,
      },
      {
        onSuccess: (newRole) => {
          toast.success(t("roles.toast.duplicated"));
          onBack();
        },
        onError: (err) => toast.error(t("roles.toast.duplicateFailed"), { description: err.message }),
      }
    );
  }

  function handleAssignMember(userId: string) {
    if (!currentUser) return;
    assignUserRole.mutate(
      { userId, roleId, assignedBy: currentUser.id },
      {
        onSuccess: () => {
          toast.success(t("roles.toast.memberAssigned"));
          setShowAddMember(false);
        },
        onError: (err) => toast.error(t("roles.toast.assignFailed"), { description: err.message }),
      }
    );
  }

  function handleRemoveMember(userId: string) {
    removeUserRole.mutate(
      { userId, roleId },
      {
        onSuccess: () => toast.success(t("roles.toast.memberRemoved")),
        onError: (err) => toast.error(t("roles.toast.removeFailed"), { description: err.message }),
      }
    );
  }

  // ── Filter permissions by search ─────────────────────────────
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return PERMISSION_CATEGORIES;

    const q = searchQuery.toLowerCase();
    return PERMISSION_CATEGORIES.map((cat) => ({
      ...cat,
      modules: cat.modules
        .map((mod) => ({
          ...mod,
          actions: mod.actions.filter((a) =>
            a.label.toLowerCase().includes(q)
          ),
        }))
        .filter((mod) => mod.actions.length > 0),
    })).filter((cat) => cat.modules.length > 0);
  }, [searchQuery]);

  // Members assigned to this role
  const assignedUserIds = new Set(roleMembers?.map((m) => m.userId) ?? []);
  const assignedMembers = members.filter((m) => assignedUserIds.has(m.id));
  const unassignedMembers = members.filter(
    (m) => !assignedUserIds.has(m.id) && m.isActive !== false
  );

  if (permLoading || !role) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-[600px] animate-slide-up">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-[6px] font-mohave text-body-sm uppercase text-text-tertiary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-[14px] h-[14px]" />
          {t("roles.back")}
        </button>
        {!isPreset && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || updatePermissions.isPending}
            loading={updatePermissions.isPending}
            className={cn(isDirty && "animate-pulse-live")}
          >
            {t("roles.saveChanges")}
          </Button>
        )}
      </div>

      {/* Preset banner */}
      {isPreset && (
        <div className="flex items-center justify-between p-1.5 bg-[rgba(255,255,255,0.02)] border border-border rounded">
          <p className="font-kosugi text-[11px] text-text-disabled">
            {t("roles.presetBanner")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDuplicate}
            disabled={duplicateRole.isPending}
            className="gap-[4px] shrink-0"
          >
            <Copy className="w-[14px] h-[14px]" />
            {t("roles.duplicate")}
          </Button>
        </div>
      )}

      {/* Role name + description */}
      <Card>
        <CardContent className="space-y-1.5 py-1.5">
          <Input
            label={t("roles.nameLabel")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPreset}
            placeholder={t("roles.namePlaceholder")}
          />
          <Input
            label={t("roles.descriptionLabel")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isPreset}
            placeholder={t("roles.descriptionPlaceholder")}
          />
        </CardContent>
      </Card>

      {/* Permissions */}
      <Card>
        <CardHeader>
          <CardTitle>{t("roles.permissionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Search */}
          <div className="relative mb-1.5">
            <Search className="absolute left-[10px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-disabled" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("roles.searchPlaceholder")}
              className="w-full pl-[32px] pr-[32px] py-[8px] bg-background-input border border-border rounded font-kosugi text-caption text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-ops-accent transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-[10px] top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-primary transition-colors"
              >
                <X className="w-[14px] h-[14px]" />
              </button>
            )}
          </div>

          {/* Permission categories + modules */}
          {filteredCategories.length === 0 ? (
            <p className="font-kosugi text-[11px] text-text-disabled py-2 text-center">
              {t("roles.noPermissionsMatch")} &ldquo;{searchQuery}&rdquo;
            </p>
          ) : (
            filteredCategories.map((category) => (
              <div key={category.id}>
                {/* Category header */}
                <div className="flex items-center gap-1.5 mt-2 mb-0.5">
                  <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
                  <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider shrink-0">
                    {category.label}
                  </span>
                  <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
                </div>

                {/* Modules */}
                {category.modules.map((module) => (
                  <ModuleAccordion
                    key={module.id}
                    module={module}
                    permissionEdits={permissionEdits}
                    onToggle={handleToggle}
                    onScopeChange={handleScopeChange}
                    disabled={isPreset}
                    searchQuery={searchQuery || undefined}
                    forceExpanded={!!searchQuery}
                  />
                ))}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Assigned Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {t("roles.assignedMembers")} ({assignedMembers.length})
            </CardTitle>
            {!isPreset && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAddMember(!showAddMember)}
                className="gap-[4px]"
              >
                <UserPlus className="w-[14px] h-[14px]" />
                {t("roles.addMember")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Add member dropdown */}
          {showAddMember && (
            <div className="mb-1.5 p-1 bg-[rgba(255,255,255,0.02)] border border-border rounded animate-scale-in">
              {unassignedMembers.length === 0 ? (
                <p className="font-kosugi text-[11px] text-text-disabled px-1 py-[6px]">
                  {t("roles.allMembersAssigned")}
                </p>
              ) : (
                unassignedMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => handleAssignMember(member.id)}
                    className="w-full flex items-center gap-1 px-1 py-[6px] rounded font-mohave text-body-sm text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                  >
                    <div className="w-[24px] h-[24px] rounded-full flex items-center justify-center shrink-0 border border-ops-accent">
                      <span className="font-mohave text-[10px] text-ops-accent">
                        {getInitials(getUserFullName(member))}
                      </span>
                    </div>
                    {getUserFullName(member)}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Member list */}
          {assignedMembers.length === 0 ? (
            <p className="font-kosugi text-[11px] text-text-disabled py-1">
              {t("roles.noMembersAssigned")}
            </p>
          ) : (
            <div className="space-y-0">
              {assignedMembers.map((member) => {
                const fullName = getUserFullName(member);
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-[28px] h-[28px] rounded-full flex items-center justify-center border border-ops-accent">
                        <span className="font-mohave text-[10px] text-ops-accent">
                          {getInitials(fullName)}
                        </span>
                      </div>
                      <div>
                        <p className="font-mohave text-body-sm text-text-primary">{fullName}</p>
                        <p className="font-mono text-[10px] text-text-disabled">
                          {member.email ?? ""}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(member.id)}
                      className="flex items-center gap-[4px] font-kosugi text-[10px] text-text-disabled hover:text-ops-error transition-colors"
                    >
                      <UserMinus className="w-[12px] h-[12px]" />
                      {t("roles.remove")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm discard dialog */}
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

// ─── Role List ───────────────────────────────────────────────────────────────

function RoleRow({
  role,
  memberCount,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  role: { id: string; name: string; description: string | null; isPreset: boolean };
  memberCount: number;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
}) {
  const { t } = useDictionary("settings");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "flex items-center justify-between py-[10px] border-b border-[rgba(255,255,255,0.04)] last:border-0",
        role.isPreset && "opacity-80"
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {role.isPreset ? (
          <Lock className="w-[12px] h-[12px] text-text-disabled shrink-0" />
        ) : (
          <div className="w-[12px] h-[12px] shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-mohave text-body text-text-primary">{role.name}</p>
          {role.description && (
            <p className="font-kosugi text-[11px] text-text-disabled truncate max-w-[350px]">
              {role.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <span className="font-mono text-[10px] text-text-disabled mr-0.5">
          {memberCount} {memberCount === 1 ? t("roles.member") : t("roles.members")}
        </span>

        {!role.isPreset && (
          <Button variant="ghost" size="sm" onClick={onEdit} className="text-text-tertiary">
            {t("roles.edit")}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={onDuplicate}
          className="text-text-tertiary gap-[4px]"
        >
          <Copy className="w-[12px] h-[12px]" />
          {t("roles.duplicate")}
        </Button>

        {/* Overflow menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-[6px] rounded hover:bg-background-elevated transition-colors"
          >
            <MoreHorizontal className="w-[14px] h-[14px] text-text-tertiary" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-[4px] z-50 min-w-[160px] bg-background-card border border-border rounded-lg shadow-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    onEdit();
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-1.5 py-[8px] font-mohave text-body-sm text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors"
                >
                  {role.isPreset ? t("roles.viewPermissions") : t("roles.editPermissions")}
                </button>
                {!role.isPreset && onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      onDelete();
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-1.5 py-[8px] font-mohave text-body-sm text-ops-error hover:bg-background-elevated transition-colors"
                  >
                    {t("roles.deleteRole")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Tab ────────────────────────────────────────────────────────────────

export function RolesTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data: roles, isLoading } = useRoles();
  const { data: allUserRoles } = useAllUserRoles();
  const duplicateRole = useDuplicateRole();
  const deleteRole = useDeleteRole();

  const [view, setView] = useState<View>("list");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const createRole = useCreateRole();

  // Count members per role
  const memberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (allUserRoles) {
      for (const ur of allUserRoles) {
        counts.set(ur.roleId, (counts.get(ur.roleId) ?? 0) + 1);
      }
    }
    return counts;
  }, [allUserRoles]);

  const presetRoles = roles?.filter((r) => r.isPreset) ?? [];
  const customRoles = roles?.filter((r) => !r.isPreset) ?? [];

  function handleEdit(roleId: string) {
    setSelectedRoleId(roleId);
    setView("editor");
  }

  function handleDuplicate(roleId: string, roleName: string) {
    duplicateRole.mutate(
      {
        sourceRoleId: roleId,
        companyId,
        newName: `${roleName} (Copy)`,
      },
      {
        onSuccess: () => toast.success(t("roles.toast.duplicated")),
        onError: (err) => toast.error(t("roles.toast.duplicateFailed"), { description: err.message }),
      }
    );
  }

  function handleDelete(roleId: string) {
    deleteRole.mutate(roleId, {
      onSuccess: () => {
        toast.success(t("roles.toast.deleted"));
        setConfirmDelete(null);
      },
      onError: (err) => toast.error(t("roles.toast.deleteFailed"), { description: err.message }),
    });
  }

  function handleCreate() {
    if (!newName.trim()) return;
    createRole.mutate(
      {
        name: newName.trim(),
        description: newDescription.trim() || null,
        companyId,
        hierarchy: 5,
      },
      {
        onSuccess: (role) => {
          toast.success(t("roles.toast.created"));
          setNewName("");
          setNewDescription("");
          setShowCreate(false);
          // Navigate to editor
          setSelectedRoleId(role.id);
          setView("editor");
        },
        onError: (err) => toast.error(t("roles.toast.createFailed"), { description: err.message }),
      }
    );
  }

  // ── Editor view ──────────────────────────────────────────────
  if (view === "editor" && selectedRoleId) {
    return (
      <RoleEditor
        roleId={selectedRoleId}
        onBack={() => {
          setView("list");
          setSelectedRoleId(null);
        }}
      />
    );
  }

  // ── List view ────────────────────────────────────────────────
  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("roles.title")}</CardTitle>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCreate(!showCreate)}
              className="gap-[4px]"
            >
              <Plus className="w-[14px] h-[14px]" />
              {t("roles.createRole")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="font-kosugi text-[11px] text-text-disabled mb-1.5">
            {t("roles.subtitle")}
          </p>

          {/* Create form */}
          {showCreate && (
            <div className="flex items-end gap-1 p-1.5 mb-1.5 bg-[rgba(255,255,255,0.02)] border border-border rounded animate-scale-in">
              <Input
                label={t("roles.nameLabel")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("roles.namePlaceholder")}
                className="flex-1"
                autoFocus
              />
              <Input
                label={t("roles.descriptionLabel")}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t("roles.descriptionPlaceholder")}
                className="flex-1"
              />
              <Button
                onClick={handleCreate}
                disabled={!newName.trim() || createRole.isPending}
                loading={createRole.isPending}
                size="sm"
              >
                {t("roles.create")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                <X className="w-[14px] h-[14px]" />
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : (
            <>
              {/* Preset roles */}
              <div className="flex items-center gap-1.5 mt-1 mb-0.5">
                <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
                <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
                  {t("roles.presets")}
                </span>
                <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
              </div>

              {presetRoles.map((role) => (
                <RoleRow
                  key={role.id}
                  role={role}
                  memberCount={memberCounts.get(role.id) ?? 0}
                  onEdit={() => handleEdit(role.id)}
                  onDuplicate={() => handleDuplicate(role.id, role.name)}
                />
              ))}

              {/* Custom roles */}
              <div className="flex items-center gap-1.5 mt-2 mb-0.5">
                <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
                <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
                  {t("roles.customRoles")}
                </span>
                <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
              </div>

              {customRoles.length === 0 ? (
                <p className="font-kosugi text-[11px] text-text-disabled py-2 text-center">
                  {t("roles.noCustomRoles")}
                </p>
              ) : (
                customRoles.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    memberCount={memberCounts.get(role.id) ?? 0}
                    onEdit={() => handleEdit(role.id)}
                    onDuplicate={() => handleDuplicate(role.id, role.name)}
                    onDelete={() => setConfirmDelete(role.id)}
                  />
                ))
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(open) => !open && setConfirmDelete(null)}
          title={t("roles.deleteConfirmTitle")}
          description={t("roles.deleteConfirmDescription")}
          confirmLabel={t("roles.delete")}
          variant="destructive"
          onConfirm={() => handleDelete(confirmDelete)}
          loading={deleteRole.isPending}
        />
      )}
    </div>
  );
}
