"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Lock,
  Copy,
  Plus,
  X,
  ArrowLeft,
  MoreHorizontal,
  Loader2,
  UserPlus,
  UserMinus,
  GripVertical,
  HelpCircle,
  LayoutGrid,
  List,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type PermissionTier,
  type PermissionModule,
  type RolePermission,
  getActionsForTier,
  detectModuleTier,
  getModulesWithScopes,
} from "@/lib/types/permissions";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Types ───────────────────────────────────────────────────────────────────

type View = "list" | "editor";
type ListMode = "rows" | "board";

interface PermissionEdit {
  permission: string;
  scope: PermissionScope;
  enabled: boolean;
}

// ─── Tier Column Color Helpers ───────────────────────────────────────────────

const TIER_BORDER_COLORS: Record<PermissionTier, string> = {
  view: "border-t-blue-500/60",
  manage: "border-t-amber-500/60",
  full: "border-t-emerald-500/60",
};

const TIER_HEADER_COLORS: Record<PermissionTier, string> = {
  view: "text-blue-400",
  manage: "text-amber-400",
  full: "text-emerald-400",
};

const TIER_ACTIVE_BG: Record<PermissionTier, string> = {
  view: "bg-blue-500/10",
  manage: "bg-amber-500/10",
  full: "bg-emerald-500/10",
};

const TIER_CARD_BORDER: Record<PermissionTier, string> = {
  view: "border-l-blue-500/40",
  manage: "border-l-amber-500/40",
  full: "border-l-emerald-500/40",
};

// ─── Tooltip Component ──────────────────────────────────────────────────────

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-text-disabled hover:text-text-tertiary transition-colors"
      >
        <HelpCircle className="w-[12px] h-[12px]" />
      </button>
      {show && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-[6px] z-50 px-[10px] py-[6px] bg-background-elevated border border-border rounded shadow-lg max-w-[220px] whitespace-normal">
          <p className="font-kosugi text-[10px] text-text-secondary leading-tight">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── PaletteCard ─────────────────────────────────────────────────────────────

function PaletteCard({
  moduleId,
  label,
  grantedTier,
  disabled,
  onClick,
}: {
  moduleId: string;
  label: string;
  grantedTier: PermissionTier | null;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useDictionary("settings");
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `palette-${moduleId}`,
      data: { type: "palette", moduleId },
      disabled: disabled || grantedTier !== null,
    });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const isGranted = grantedTier !== null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-[6px] px-[8px] py-[6px] border border-border rounded transition-all duration-150",
        "group/palette-card",
        isDragging && "opacity-20",
        isGranted
          ? "opacity-40 cursor-default"
          : disabled
            ? "opacity-40 cursor-not-allowed"
            : "cursor-pointer hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.02)]"
      )}
      onClick={() => {
        if (!disabled && !isGranted) onClick();
      }}
    >
      {/* Drag handle */}
      {!disabled && !isGranted && (
        <div
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover/palette-card:opacity-100 transition-opacity"
        >
          <GripVertical className="w-[12px] h-[12px] text-text-disabled" />
        </div>
      )}
      {(disabled || isGranted) && (
        <div className="shrink-0 w-[12px] h-[12px]" />
      )}

      <span className="font-kosugi text-[11px] text-text-secondary flex-1 min-w-0 truncate">
        {label}
      </span>

      {/* Badge showing current tier if granted */}
      {isGranted && (
        <span className="font-mono text-[9px] text-text-disabled bg-background-elevated px-[6px] py-[2px] rounded-sm shrink-0">
          {grantedTier === "view"
            ? t("roles.tierViewOnly")
            : grantedTier === "manage"
              ? t("roles.tierManage")
              : t("roles.tierFullAccess")}
        </span>
      )}

      {/* Plus indicator for ungranted */}
      {!isGranted && !disabled && (
        <Plus className="w-[12px] h-[12px] text-text-disabled opacity-0 group-hover/palette-card:opacity-100 transition-opacity shrink-0" />
      )}
    </div>
  );
}

// ─── PaletteCategoryHeader ───────────────────────────────────────────────────

function PaletteCategoryHeader({
  categoryId,
  label,
  onBulkAdd,
  disabled,
}: {
  categoryId: string;
  label: string;
  onBulkAdd: () => void;
  disabled?: boolean;
}) {
  const { t } = useDictionary("settings");
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `palette-cat-${categoryId}`,
      data: { type: "palette-category", categoryId },
      disabled,
    });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 mt-1.5 mb-0.5",
        isDragging && "opacity-20"
      )}
    >
      <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
      <div
        {...attributes}
        {...listeners}
        className={cn(
          "flex items-center gap-[4px] shrink-0",
          !disabled && "cursor-grab active:cursor-grabbing"
        )}
      >
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
          {label}
        </span>
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={onBulkAdd}
          className="flex items-center gap-[2px] font-kosugi text-[9px] text-text-disabled hover:text-ops-accent transition-colors shrink-0"
        >
          <Plus className="w-[10px] h-[10px]" />
          {t("roles.bulkAddCategory")}
        </button>
      )}
      <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
    </div>
  );
}

// ─── PermissionPalette ───────────────────────────────────────────────────────

function PermissionPalette({
  grantedModules,
  onClickAdd,
  onBulkAdd,
  disabled,
  isDropTarget,
}: {
  grantedModules: Map<string, PermissionTier>;
  onClickAdd: (moduleId: string) => void;
  onBulkAdd: (categoryId: string, tier: PermissionTier) => void;
  disabled?: boolean;
  isDropTarget?: boolean;
}) {
  const { t } = useDictionary("settings");
  const { setNodeRef, isOver } = useDroppable({ id: "palette-drop" });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-[280px] shrink-0 border-r border-border overflow-y-auto p-1.5",
        "transition-colors duration-150",
        isOver && "bg-[rgba(255,80,80,0.05)]"
      )}
    >
      {/* Header */}
      <div className="mb-1">
        <h3 className="font-mohave text-body-sm uppercase tracking-wider text-text-primary">
          {t("roles.palette")}
        </h3>
        <p className="font-kosugi text-[10px] text-text-disabled mt-[2px]">
          {t("roles.paletteHint")}
        </p>
      </div>

      {/* Drop to remove indicator */}
      {isDropTarget && (
        <div
          className={cn(
            "flex items-center justify-center py-[8px] mb-1 border border-dashed rounded transition-colors duration-150",
            isOver
              ? "border-ops-error bg-[rgba(255,80,80,0.08)] text-ops-error"
              : "border-border text-text-disabled"
          )}
        >
          <span className="font-kosugi text-[10px]">
            {t("roles.dragToRemove")}
          </span>
        </div>
      )}

      {/* Categories + modules */}
      {PERMISSION_CATEGORIES.map((category) => (
        <div key={category.id}>
          <PaletteCategoryHeader
            categoryId={category.id}
            label={category.label}
            onBulkAdd={() => onBulkAdd(category.id, "view")}
            disabled={disabled}
          />
          <div className="space-y-[4px]">
            {category.modules.map((mod) => (
              <PaletteCard
                key={mod.id}
                moduleId={mod.id}
                label={mod.label}
                grantedTier={grantedModules.get(mod.id) ?? null}
                disabled={disabled}
                onClick={() => onClickAdd(mod.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── TierModuleCard ──────────────────────────────────────────────────────────

function TierModuleCard({
  moduleId,
  label,
  tier,
  onRemove,
  disabled,
  isCustom,
  availableScopes,
  currentScope,
  onScopeChange,
}: {
  moduleId: string;
  label: string;
  tier: PermissionTier;
  onRemove: () => void;
  disabled?: boolean;
  isCustom?: boolean;
  availableScopes?: PermissionScope[];
  currentScope?: PermissionScope;
  onScopeChange?: (scope: PermissionScope) => void;
}) {
  const { t } = useDictionary("settings");
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `tier-${moduleId}`,
      data: { type: "tier", moduleId, tier },
      disabled,
    });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const scopeLabels: Record<PermissionScope, string> = {
    all: t("roles.scopeAll"),
    assigned: t("roles.scopeAssignedOnly"),
    own: t("roles.scopeOwn"),
  };

  const hasScopes = availableScopes && availableScopes.length > 1;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-[6px] px-[8px] py-[6px] border rounded border-l-2 transition-all duration-150",
        "group/tier-card",
        TIER_CARD_BORDER[tier],
        "border-border bg-[rgba(255,255,255,0.02)]",
        isDragging && "opacity-20",
        !disabled &&
          "hover:bg-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.12)]"
      )}
    >
      {/* Drag handle */}
      {!disabled && (
        <div
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover/tier-card:opacity-100 transition-opacity"
        >
          <GripVertical className="w-[12px] h-[12px] text-text-disabled" />
        </div>
      )}

      <span className="font-kosugi text-[11px] text-text-secondary flex-1 min-w-0 truncate">
        {label}
      </span>

      {/* Custom badge for non-standard tier mapping */}
      {isCustom && (
        <span className="font-mono text-[9px] text-ops-accent bg-ops-accent-muted px-[4px] py-[1px] rounded-sm shrink-0">
          {t("roles.customPermissions")}
        </span>
      )}

      {/* Inline scope picker — far right, inline with title */}
      {hasScopes && (
        <div className="flex items-center gap-0 shrink-0">
          {availableScopes.map((scope) => (
            <button
              key={scope}
              type="button"
              disabled={disabled}
              onClick={() => onScopeChange?.(scope)}
              className={cn(
                "px-[5px] py-[2px] font-kosugi text-[8px] uppercase tracking-wider",
                "border transition-colors duration-150",
                "first:rounded-l last:rounded-r",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                currentScope === scope
                  ? "bg-ops-accent-muted text-ops-accent border-ops-accent"
                  : "bg-transparent text-text-disabled border-border hover:text-text-tertiary"
              )}
            >
              {scopeLabels[scope]}
            </button>
          ))}
        </div>
      )}

      {/* Remove button */}
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 opacity-0 group-hover/tier-card:opacity-100 text-text-disabled hover:text-ops-error transition-all"
          title={t("roles.removePermission")}
        >
          <X className="w-[12px] h-[12px]" />
        </button>
      )}
    </div>
  );
}

// ─── TierColumn ──────────────────────────────────────────────────────────────

function TierColumn({
  tier,
  modules,
  onRemove,
  disabled,
  onScopeChange,
}: {
  tier: PermissionTier;
  modules: { moduleId: string; label: string; isCustom?: boolean; availableScopes?: PermissionScope[]; currentScope?: PermissionScope }[];
  onRemove: (moduleId: string) => void;
  disabled?: boolean;
  onScopeChange?: (moduleId: string, scope: PermissionScope) => void;
}) {
  const { t } = useDictionary("settings");
  const { setNodeRef, isOver } = useDroppable({ id: `tier-${tier}` });

  const tierLabel =
    tier === "view"
      ? t("roles.tierViewOnly")
      : tier === "manage"
        ? t("roles.tierManage")
        : t("roles.tierFullAccess");

  const tierTooltip =
    tier === "view"
      ? t("roles.tierTooltipView")
      : tier === "manage"
        ? t("roles.tierTooltipManage")
        : t("roles.tierTooltipFull");

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Column header */}
      <div
        className={cn(
          "border-t-2 rounded-t-sm px-1.5 py-1 bg-background-elevated border border-border border-b-0",
          TIER_BORDER_COLORS[tier]
        )}
      >
        <div className="flex items-center gap-[6px]">
          <h3
            className={cn(
              "font-mohave text-body-sm font-medium uppercase tracking-wider",
              TIER_HEADER_COLORS[tier]
            )}
          >
            {tierLabel}
          </h3>
          <span className="font-mono text-[11px] text-text-disabled bg-background-elevated px-[6px] py-[2px] rounded-sm">
            {modules.length}
          </span>
          <Tooltip text={tierTooltip} />
        </div>
      </div>

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 border border-border border-t-0 rounded-b p-1 space-y-[4px] min-h-[160px] transition-colors duration-150",
          isOver
            ? cn("border-ops-accent", TIER_ACTIVE_BG[tier])
            : "bg-[rgba(10,10,10,0.5)]"
        )}
      >
        {modules.map((mod) => (
          <TierModuleCard
            key={mod.moduleId}
            moduleId={mod.moduleId}
            label={mod.label}
            tier={tier}
            onRemove={() => onRemove(mod.moduleId)}
            disabled={disabled}
            isCustom={mod.isCustom}
            availableScopes={mod.availableScopes}
            currentScope={mod.currentScope}
            onScopeChange={onScopeChange ? (scope) => onScopeChange(mod.moduleId, scope) : undefined}
          />
        ))}

        {modules.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[120px] border border-dashed border-border rounded gap-1">
            <span className="font-kosugi text-[10px] text-text-disabled text-center px-1">
              {t("roles.noPermissionsGranted")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PermissionBoard (Desktop DnD Board) ─────────────────────────────────────

function PermissionBoard({
  permissionEdits,
  grantedModules,
  onAddModule,
  onMoveModule,
  onRemoveModule,
  onBulkAdd,
  onScopeChange,
  disabled,
}: {
  permissionEdits: Map<string, PermissionEdit>;
  grantedModules: Map<string, PermissionTier | "custom">;
  onAddModule: (moduleId: string, tier: PermissionTier) => void;
  onMoveModule: (moduleId: string, newTier: PermissionTier) => void;
  onRemoveModule: (moduleId: string) => void;
  onBulkAdd: (categoryId: string, tier: PermissionTier) => void;
  onScopeChange?: (moduleId: string, scope: PermissionScope) => void;
  disabled?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<string | null>(null);
  const [isDraggingTierCard, setIsDraggingTierCard] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Build module lists for each tier column (with scope data)
  const tierModules = useMemo(() => {
    const result: Record<
      PermissionTier,
      { moduleId: string; label: string; isCustom?: boolean; availableScopes?: PermissionScope[]; currentScope?: PermissionScope }[]
    > = {
      view: [],
      manage: [],
      full: [],
    };

    for (const cat of PERMISSION_CATEGORIES) {
      for (const mod of cat.modules) {
        const tier = grantedModules.get(mod.id);
        if (!tier) continue;

        // Get available scopes for this module
        const scopeActions = mod.actions.filter((a) => a.scopes.length > 1);
        const availableScopes = scopeActions.length > 0
          ? Array.from(new Set(scopeActions.flatMap((a) => a.scopes))) as PermissionScope[]
          : undefined;
        const enabledScopeAction = scopeActions.find((a) => permissionEdits.get(a.id)?.enabled);
        const currentScope = enabledScopeAction ? permissionEdits.get(enabledScopeAction.id)?.scope : undefined;

        if (tier !== "custom") {
          result[tier].push({ moduleId: mod.id, label: mod.label, availableScopes, currentScope });
        } else {
          // Custom tier: figure out the closest tier for display
          const enabledActions = mod.actions
            .filter((a) => permissionEdits.get(a.id)?.enabled)
            .map((a) => a.id);
          const detected = detectModuleTier(mod.id, enabledActions);
          const displayTier = detected ?? "view";
          result[displayTier].push({
            moduleId: mod.id,
            label: mod.label,
            isCustom: true,
            availableScopes,
            currentScope,
          });
        }
      }
    }

    return result;
  }, [grantedModules, permissionEdits]);

  // Palette granted map: convert "custom" to detected tier for display
  const paletteGranted = useMemo(() => {
    const map = new Map<string, PermissionTier>();
    for (const [moduleId, tier] of grantedModules) {
      if (tier === "custom") {
        const mod = PERMISSION_CATEGORIES.flatMap((c) => c.modules).find(
          (m) => m.id === moduleId
        );
        if (mod) {
          const enabledActions = mod.actions
            .filter((a) => permissionEdits.get(a.id)?.enabled)
            .map((a) => a.id);
          const detected = detectModuleTier(moduleId, enabledActions);
          if (detected) map.set(moduleId, detected);
          else map.set(moduleId, "view");
        }
      } else {
        map.set(moduleId, tier);
      }
    }
    return map;
  }, [grantedModules, permissionEdits]);

  // Active drag info for overlay
  const activeDragInfo = useMemo(() => {
    if (!activeId) return null;

    if (activeId.startsWith("palette-cat-")) {
      const catId = activeId.replace("palette-cat-", "");
      const cat = PERMISSION_CATEGORIES.find((c) => c.id === catId);
      return cat ? { type: "category" as const, label: cat.label, catId } : null;
    }

    if (activeId.startsWith("palette-")) {
      const modId = activeId.replace("palette-", "");
      const mod = PERMISSION_CATEGORIES.flatMap((c) => c.modules).find(
        (m) => m.id === modId
      );
      return mod ? { type: "module" as const, label: mod.label, modId } : null;
    }

    if (activeId.startsWith("tier-") && activeDragType === "tier") {
      const modId = activeId.replace("tier-", "");
      const mod = PERMISSION_CATEGORIES.flatMap((c) => c.modules).find(
        (m) => m.id === modId
      );
      return mod ? { type: "tier-module" as const, label: mod.label, modId } : null;
    }

    return null;
  }, [activeId, activeDragType]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    const data = event.active.data.current;
    setActiveDragType(data?.type ?? null);
    setIsDraggingTierCard(data?.type === "tier");
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setActiveDragType(null);
    setIsDraggingTierCard(false);

    if (!over) return;

    const data = active.data.current;
    const overId = over.id as string;

    // Determine target tier
    const tiers: PermissionTier[] = ["view", "manage", "full"];
    const targetTier = overId.startsWith("tier-")
      ? (overId.replace("tier-", "") as PermissionTier)
      : null;

    if (data?.type === "palette" && targetTier && tiers.includes(targetTier)) {
      onAddModule(data.moduleId, targetTier);
    } else if (data?.type === "palette-category" && targetTier && tiers.includes(targetTier)) {
      onBulkAdd(data.categoryId, targetTier);
    } else if (data?.type === "tier") {
      if (targetTier && tiers.includes(targetTier) && targetTier !== data.tier) {
        onMoveModule(data.moduleId, targetTier);
      } else if (overId === "palette-drop") {
        onRemoveModule(data.moduleId);
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-0 min-h-[300px]">
        {/* Palette */}
        <PermissionPalette
          grantedModules={paletteGranted}
          onClickAdd={(moduleId) => onAddModule(moduleId, "view")}
          onBulkAdd={onBulkAdd}
          disabled={disabled}
          isDropTarget={isDraggingTierCard}
        />

        {/* Tier columns */}
        <div className="flex-1 flex gap-1.5 p-1.5 overflow-x-auto">
          {(["view", "manage", "full"] as PermissionTier[]).map((tier) => (
            <TierColumn
              key={tier}
              tier={tier}
              modules={tierModules[tier]}
              onRemove={onRemoveModule}
              disabled={disabled}
              onScopeChange={onScopeChange}
            />
          ))}
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDragInfo ? (
          <div className="opacity-80 scale-105 shadow-lg px-[10px] py-[6px] bg-background-card border border-ops-accent rounded font-kosugi text-[11px] text-text-primary">
            {activeDragInfo.label}
            {activeDragInfo.type === "category" && (
              <span className="ml-[6px] font-mono text-[9px] text-text-disabled">
                (category)
              </span>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─── MobilePermissionEditor ──────────────────────────────────────────────────

function MobilePermissionEditor({
  permissionEdits,
  grantedModules,
  onAddModule,
  onMoveModule,
  onRemoveModule,
  onBulkAdd,
  disabled,
}: {
  permissionEdits: Map<string, PermissionEdit>;
  grantedModules: Map<string, PermissionTier | "custom">;
  onAddModule: (moduleId: string, tier: PermissionTier) => void;
  onMoveModule: (moduleId: string, newTier: PermissionTier) => void;
  onRemoveModule: (moduleId: string) => void;
  onBulkAdd: (categoryId: string, tier: PermissionTier) => void;
  disabled?: boolean;
}) {
  const { t } = useDictionary("settings");

  const tiers: (PermissionTier | "none")[] = ["none", "view", "manage", "full"];
  const tierLabels: Record<string, string> = {
    none: t("roles.tierNone"),
    view: t("roles.tierViewOnly"),
    manage: t("roles.tierManage"),
    full: t("roles.tierFullAccess"),
  };

  function getModuleTier(
    moduleId: string
  ): PermissionTier | "none" | "custom" {
    const tier = grantedModules.get(moduleId);
    if (!tier) return "none";
    return tier;
  }

  function handleTierChange(
    moduleId: string,
    newTier: PermissionTier | "none"
  ) {
    const current = grantedModules.get(moduleId);
    if (newTier === "none") {
      if (current) onRemoveModule(moduleId);
    } else if (!current) {
      onAddModule(moduleId, newTier);
    } else {
      onMoveModule(moduleId, newTier);
    }
  }

  return (
    <div className="space-y-1">
      {PERMISSION_CATEGORIES.map((category) => (
        <div key={category.id}>
          {/* Category header */}
          <div className="flex items-center gap-1 mt-1.5 mb-0.5">
            <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider shrink-0">
              {category.label}
            </span>
            <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
          </div>

          {/* Module rows */}
          {category.modules.map((mod) => {
            const currentTier = getModuleTier(mod.id);
            const displayTier = currentTier === "custom" ? "view" : currentTier;

            return (
              <div
                key={mod.id}
                className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
              >
                <span className="font-kosugi text-[11px] text-text-secondary min-w-0 flex-1 truncate mr-1">
                  {mod.label}
                </span>

                {/* Segmented picker */}
                <div className="flex items-center gap-0 shrink-0">
                  {tiers.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleTierChange(mod.id, tier)}
                      className={cn(
                        "px-[6px] py-[3px] font-kosugi text-[9px] uppercase tracking-wider",
                        "border transition-colors duration-150",
                        "first:rounded-l last:rounded-r",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                        displayTier === tier
                          ? "bg-ops-accent-muted text-ops-accent border-ops-accent"
                          : "bg-transparent text-text-disabled border-border hover:text-text-tertiary"
                      )}
                    >
                      {tierLabels[tier]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── DataScopeCard ───────────────────────────────────────────────────────────

function DataScopeCard({
  grantedModules,
  scopeEdits,
  onScopeChange,
  disabled,
}: {
  grantedModules: Map<string, PermissionTier | "custom">;
  scopeEdits: Map<string, PermissionScope>;
  onScopeChange: (moduleId: string, scope: PermissionScope) => void;
  disabled?: boolean;
}) {
  const { t } = useDictionary("settings");

  const modulesWithScopes = getModulesWithScopes();
  const eligibleModules = modulesWithScopes.filter((mod) =>
    grantedModules.has(mod.id)
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-[6px]">
          <CardTitle>{t("roles.dataScope")}</CardTitle>
          <Tooltip text={t("roles.dataScopeHint")} />
        </div>
      </CardHeader>
      <CardContent>
        {eligibleModules.length === 0 ? (
          <p className="font-kosugi text-[11px] text-text-disabled py-1">
            {t("roles.noScopePermissions")}
          </p>
        ) : (
          <div className="space-y-0">
            {eligibleModules.map((mod) => {
              const currentScope = scopeEdits.get(mod.id) ?? "all";
              // Get the unique scopes available across module actions
              const availableScopes = Array.from(
                new Set(mod.actions.flatMap((a) => a.scopes))
              ) as PermissionScope[];

              if (availableScopes.length <= 1) return null;

              const scopeLabels: Record<PermissionScope, string> = {
                all: t("roles.scopeAll"),
                assigned: t("roles.scopeAssignedOnly"),
                own: t("roles.scopeOwn"),
              };

              return (
                <div
                  key={mod.id}
                  className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
                >
                  <span className="font-kosugi text-[11px] text-text-secondary flex-1 min-w-0 truncate mr-1">
                    {mod.label}
                  </span>
                  <div className="flex items-center gap-0 shrink-0">
                    {availableScopes.map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        disabled={disabled}
                        onClick={() => onScopeChange(mod.id, scope)}
                        className={cn(
                          "px-[8px] py-[3px] font-kosugi text-[10px] uppercase tracking-wider",
                          "border transition-colors duration-150",
                          "first:rounded-l last:rounded-r",
                          "disabled:opacity-40 disabled:cursor-not-allowed",
                          currentScope === scope
                            ? "bg-ops-accent-muted text-ops-accent border-ops-accent"
                            : "bg-transparent text-text-disabled border-border hover:text-text-tertiary"
                        )}
                      >
                        {scopeLabels[scope]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
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
  const { data: permissions, isLoading: permLoading } =
    useRolePermissions(roleId);
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
  const [showAddMember, setShowAddMember] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [permViewMode, setPermViewMode] = useState<"board" | "list">("board");

  // Responsive detection
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 799px)");
    setIsMobile(mql.matches);
    function handler(e: MediaQueryListEvent) {
      setIsMobile(e.matches);
    }
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Build permission edits from fetched data
  const [permissionEdits, setPermissionEdits] = useState<
    Map<string, PermissionEdit>
  >(new Map());
  const [initializedPerms, setInitializedPerms] = useState(false);

  // Initialize permission edits once data loads
  useEffect(() => {
    if (permissions && !initializedPerms) {
      const map = new Map<string, PermissionEdit>();
      for (const cat of PERMISSION_CATEGORIES) {
        for (const mod of cat.modules) {
          for (const action of mod.actions) {
            const existing = permissions.find(
              (p) => p.permission === action.id
            );
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

  // ── Derived: granted modules map ──────────────────────────────
  const grantedModules = useMemo(() => {
    const map = new Map<string, PermissionTier | "custom">();
    const enabledPermissions = Array.from(permissionEdits.entries())
      .filter(([, e]) => e.enabled)
      .map(([key]) => key);

    for (const cat of PERMISSION_CATEGORIES) {
      for (const mod of cat.modules) {
        const detected = detectModuleTier(mod.id, enabledPermissions);
        if (detected) {
          map.set(mod.id, detected);
        } else {
          // Check if ANY permission is enabled for this module
          const hasAny = mod.actions.some(
            (a) => permissionEdits.get(a.id)?.enabled
          );
          if (hasAny) {
            map.set(mod.id, "custom");
          }
        }
      }
    }

    return map;
  }, [permissionEdits]);

  // ── Derived: scope edits ──────────────────────────────────────
  const scopeEdits = useMemo(() => {
    const map = new Map<string, PermissionScope>();
    for (const cat of PERMISSION_CATEGORIES) {
      for (const mod of cat.modules) {
        // Find the dominant scope for the module (from the first scope-eligible enabled action)
        const scopeActions = mod.actions.filter(
          (a) => a.scopes.length > 1 && permissionEdits.get(a.id)?.enabled
        );
        if (scopeActions.length > 0) {
          const scope = permissionEdits.get(scopeActions[0].id)?.scope ?? "all";
          map.set(mod.id, scope);
        }
      }
    }
    return map;
  }, [permissionEdits]);

  // Track dirty state
  const isDirty = useMemo(() => {
    if (!permissions || !initializedPerms) return false;
    if (name !== (role?.name ?? "")) return true;
    if (description !== (role?.description ?? "")) return true;
    for (const [key, edit] of permissionEdits) {
      const existing = permissions.find((p) => p.permission === key);
      if (edit.enabled && !existing) return true;
      if (!edit.enabled && existing) return true;
      if (edit.enabled && existing && edit.scope !== existing.scope)
        return true;
    }
    return false;
  }, [name, description, permissionEdits, permissions, role, initializedPerms]);

  // ── Handlers ─────────────────────────────────────────────────

  const handleAddModule = useCallback(
    (moduleId: string, tier: PermissionTier) => {
      const actions = getActionsForTier(moduleId, tier);
      setPermissionEdits((prev) => {
        const next = new Map(prev);
        // First disable all for this module
        for (const cat of PERMISSION_CATEGORIES) {
          for (const mod of cat.modules) {
            if (mod.id === moduleId) {
              for (const action of mod.actions) {
                const existing = next.get(action.id);
                if (existing) {
                  next.set(action.id, { ...existing, enabled: false });
                }
              }
            }
          }
        }
        // Then enable the tier actions
        for (const actionId of actions) {
          const existing = next.get(actionId);
          if (existing) {
            next.set(actionId, { ...existing, enabled: true });
          }
        }
        return next;
      });
    },
    []
  );

  const handleMoveModule = useCallback(
    (moduleId: string, newTier: PermissionTier) => {
      handleAddModule(moduleId, newTier);
    },
    [handleAddModule]
  );

  const handleRemoveModule = useCallback((moduleId: string) => {
    setPermissionEdits((prev) => {
      const next = new Map(prev);
      for (const cat of PERMISSION_CATEGORIES) {
        for (const mod of cat.modules) {
          if (mod.id === moduleId) {
            for (const action of mod.actions) {
              const existing = next.get(action.id);
              if (existing) {
                next.set(action.id, { ...existing, enabled: false });
              }
            }
          }
        }
      }
      return next;
    });
  }, []);

  const handleBulkAdd = useCallback(
    (categoryId: string, tier: PermissionTier) => {
      const category = PERMISSION_CATEGORIES.find((c) => c.id === categoryId);
      if (!category) return;
      setPermissionEdits((prev) => {
        const next = new Map(prev);
        for (const mod of category.modules) {
          // Only add if not already granted (check if any action is enabled)
          const hasAny = mod.actions.some((a) => next.get(a.id)?.enabled);
          if (!hasAny) {
            const actions = getActionsForTier(mod.id, tier);
            for (const actionId of actions) {
              const existing = next.get(actionId);
              if (existing) {
                next.set(actionId, { ...existing, enabled: true });
              }
            }
          }
        }
        return next;
      });
    },
    []
  );

  const handleScopeChange = useCallback(
    (moduleId: string, scope: PermissionScope) => {
      setPermissionEdits((prev) => {
        const next = new Map(prev);
        for (const cat of PERMISSION_CATEGORIES) {
          for (const mod of cat.modules) {
            if (mod.id === moduleId) {
              for (const action of mod.actions) {
                if (action.scopes.includes(scope)) {
                  const existing = next.get(action.id);
                  if (existing && existing.enabled) {
                    next.set(action.id, { ...existing, scope });
                  }
                }
              }
            }
          }
        }
        return next;
      });
    },
    []
  );

  async function handleSave() {
    if (!role || isPreset) return;

    try {
      if (name !== role.name || description !== role.description) {
        await updateRole.mutateAsync({
          roleId: role.id,
          data: { name: name.trim(), description: description.trim() || null },
        });
      }

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
        onSuccess: () => {
          toast.success(t("roles.toast.duplicated"));
          onBack();
        },
        onError: (err) =>
          toast.error(t("roles.toast.duplicateFailed"), {
            description: err.message,
          }),
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
        onError: (err) =>
          toast.error(t("roles.toast.assignFailed"), {
            description: err.message,
          }),
      }
    );
  }

  function handleRemoveMember(userId: string) {
    removeUserRole.mutate(
      { userId, roleId },
      {
        onSuccess: () => toast.success(t("roles.toast.memberRemoved")),
        onError: (err) =>
          toast.error(t("roles.toast.removeFailed"), {
            description: err.message,
          }),
      }
    );
  }

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
    <div className="space-y-3 animate-slide-up">
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

      {/* Permissions Board */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("roles.permissionsTitle")}</CardTitle>
            {/* Board / List toggle */}
            {!isMobile && (
              <div className="flex items-center gap-0">
                <button
                  type="button"
                  onClick={() => setPermViewMode("board")}
                  className={cn(
                    "px-[8px] py-[3px] font-kosugi text-[10px] uppercase tracking-wider",
                    "border transition-colors duration-150 rounded-l",
                    permViewMode === "board"
                      ? "bg-ops-accent-muted text-ops-accent border-ops-accent"
                      : "bg-transparent text-text-disabled border-border hover:text-text-tertiary"
                  )}
                >
                  {t("roles.permViewBoard")}
                </button>
                <button
                  type="button"
                  onClick={() => setPermViewMode("list")}
                  className={cn(
                    "px-[8px] py-[3px] font-kosugi text-[10px] uppercase tracking-wider",
                    "border transition-colors duration-150 rounded-r",
                    permViewMode === "list"
                      ? "bg-ops-accent-muted text-ops-accent border-ops-accent"
                      : "bg-transparent text-text-disabled border-border hover:text-text-tertiary"
                  )}
                >
                  {t("roles.permViewList")}
                </button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Inline preset lock note */}
          {isPreset && (
            <div className="flex items-center justify-between px-2 py-1.5 bg-[rgba(255,255,255,0.02)] border-b border-border">
              <div className="flex items-center gap-[6px]">
                <Lock className="w-[14px] h-[14px] text-text-disabled shrink-0" />
                <p className="font-kosugi text-[11px] text-text-disabled">
                  {t("roles.cannotEditPreset")}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDuplicate}
                disabled={duplicateRole.isPending}
                loading={duplicateRole.isPending}
                className="gap-[4px] shrink-0"
              >
                <Copy className="w-[14px] h-[14px]" />
                {t("roles.duplicateToEdit")}
              </Button>
            </div>
          )}
          <div
            className={cn("relative", isPreset && "cursor-not-allowed")}
            onClickCapture={isPreset ? (e) => {
              // Block all clicks on preset permission boards, but allow hover for tooltips
              e.stopPropagation();
              e.preventDefault();
              toast(t("roles.cannotEditPreset"), {
                description: t("roles.presetBanner"),
                action: {
                  label: t("roles.duplicateToEdit"),
                  onClick: handleDuplicate,
                },
              });
            } : undefined}
          >
            {isMobile || permViewMode === "list" ? (
              <div className="p-1.5">
                <MobilePermissionEditor
                  permissionEdits={permissionEdits}
                  grantedModules={grantedModules}
                  onAddModule={handleAddModule}
                  onMoveModule={handleMoveModule}
                  onRemoveModule={handleRemoveModule}
                  onBulkAdd={handleBulkAdd}
                  disabled={isPreset}
                />
              </div>
            ) : (
              <PermissionBoard
                permissionEdits={permissionEdits}
                grantedModules={grantedModules}
                onAddModule={handleAddModule}
                onMoveModule={handleMoveModule}
                onRemoveModule={handleRemoveModule}
                onBulkAdd={handleBulkAdd}
                onScopeChange={handleScopeChange}
                disabled={isPreset}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Data Scope + Assigned Members */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Data Scope */}
        <DataScopeCard
          grantedModules={grantedModules}
          scopeEdits={scopeEdits}
          onScopeChange={handleScopeChange}
          disabled={isPreset}
        />

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
                          <p className="font-mohave text-body-sm text-text-primary">
                            {fullName}
                          </p>
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
      </div>

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

// ─── Roles Assignment Board (kanban-style) ───────────────────────────────────

function MemberDragCard({
  userId,
  name,
  email,
  profileImageURL,
  userColor,
  roleId,
  disabled,
}: {
  userId: string;
  name: string;
  email?: string;
  profileImageURL?: string | null;
  userColor?: string | null;
  roleId: string;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `member-${roleId}-${userId}`,
      data: { userId, roleId },
      disabled,
    });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const initials = getInitials(name);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-center gap-1.5 px-[8px] py-[6px] border border-border rounded",
        "bg-[rgba(255,255,255,0.02)] cursor-grab active:cursor-grabbing",
        "hover:bg-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.12)]",
        "transition-all duration-150 group/member-card",
        isDragging && "opacity-20"
      )}
    >
      <div
        className="w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0 border-2 border-ops-accent overflow-hidden"
        style={userColor ? { borderColor: userColor } : undefined}
      >
        {profileImageURL ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={profileImageURL}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="font-mohave text-[10px] text-ops-accent"
            style={userColor ? { color: userColor } : undefined}
          >
            {initials}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary truncate">{name}</p>
        {email && (
          <p className="font-mono text-[9px] text-text-disabled truncate">{email}</p>
        )}
      </div>
      <GripVertical className="w-[12px] h-[12px] text-text-disabled opacity-0 group-hover/member-card:opacity-100 transition-opacity shrink-0" />
    </div>
  );
}

function RoleAssignmentColumn({
  roleId,
  roleName,
  members,
  isPreset,
  onClickHeader,
}: {
  roleId: string;
  roleName: string;
  members: { id: string; name: string; email?: string; profileImageURL?: string | null; userColor?: string | null }[];
  isPreset: boolean;
  onClickHeader?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `role-col-${roleId}` });

  return (
    <div className="flex flex-col min-w-[220px] w-[220px] shrink-0">
      {/* Column header */}
      <div
        className={cn(
          "flex items-center gap-[6px] px-1.5 py-1 bg-background-elevated border border-border rounded-t",
          onClickHeader && "cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
        )}
        onClick={onClickHeader}
      >
        {isPreset && <Lock className="w-[10px] h-[10px] text-text-disabled shrink-0" />}
        <h3 className="font-mohave text-body-sm font-medium text-text-primary uppercase tracking-wider truncate flex-1">
          {roleName}
        </h3>
        <span className="font-mono text-[10px] text-text-disabled shrink-0">
          {members.length}
        </span>
      </div>

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 border border-border border-t-0 rounded-b p-1 space-y-[4px] min-h-[120px] transition-colors duration-150",
          isOver
            ? "bg-[rgba(89,119,159,0.08)] border-ops-accent"
            : "bg-[rgba(10,10,10,0.5)]"
        )}
      >
        {members.map((member) => (
          <MemberDragCard
            key={`${roleId}-${member.id}`}
            userId={member.id}
            name={member.name}
            email={member.email}
            profileImageURL={member.profileImageURL}
            userColor={member.userColor}
            roleId={roleId}
          />
        ))}
        {members.length === 0 && (
          <div className="flex items-center justify-center h-[80px] border border-dashed border-border rounded">
            <span className="font-kosugi text-[10px] text-text-disabled">
              —
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function RolesAssignmentBoard({
  roles,
  allUserRoles,
  onEditRole,
}: {
  roles: { id: string; name: string; isPreset: boolean }[];
  allUserRoles: { userId: string; roleId: string }[];
  onEditRole: (roleId: string) => void;
}) {
  const { t } = useDictionary("settings");
  const currentUser = useAuthStore((s) => s.currentUser);
  const { data: teamData } = useTeamMembers();
  const members = teamData?.users ?? [];
  const assignUserRole = useAssignUserRole();
  const removeUserRole = useRemoveUserRole();

  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Build role → members mapping
  const roleMembers = useMemo(() => {
    const userRoleMap = new Map<string, Set<string>>();
    for (const ur of allUserRoles) {
      if (!userRoleMap.has(ur.userId)) userRoleMap.set(ur.userId, new Set());
      userRoleMap.get(ur.userId)!.add(ur.roleId);
    }

    const result = new Map<string, { id: string; name: string; email?: string; profileImageURL?: string | null; userColor?: string | null }[]>();
    for (const role of roles) {
      result.set(role.id, []);
    }
    result.set("unassigned", []);

    for (const member of members) {
      if (member.isActive === false) continue;
      const memberInfo = {
        id: member.id,
        name: getUserFullName(member),
        email: member.email ?? undefined,
        profileImageURL: member.profileImageURL,
        userColor: member.userColor,
      };

      const assignedRoles = userRoleMap.get(member.id);
      if (!assignedRoles || assignedRoles.size === 0) {
        result.get("unassigned")!.push(memberInfo);
      } else {
        for (const roleId of assignedRoles) {
          result.get(roleId)?.push(memberInfo);
        }
      }
    }

    return result;
  }, [roles, members, allUserRoles]);

  // Active drag info for overlay
  const activeMember = useMemo(() => {
    if (!activeId) return null;
    // activeId format: "member-{roleId}-{userId}"
    const parts = activeId.replace("member-", "");
    // Find the member
    for (const member of members) {
      if (parts.endsWith(member.id)) {
        return { name: getUserFullName(member) };
      }
    }
    return null;
  }, [activeId, members]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over || !currentUser) return;

    const data = active.data.current;
    const userId = data?.userId as string;
    const sourceRoleId = data?.roleId as string;
    const targetRoleId = (over.id as string).replace("role-col-", "");

    if (sourceRoleId === targetRoleId) return;

    // Remove from source role (if not unassigned)
    if (sourceRoleId !== "unassigned") {
      removeUserRole.mutate(
        { userId, roleId: sourceRoleId },
        { onError: (err) => toast.error(t("roles.toast.reassignFailed"), { description: err.message }) }
      );
    }

    // Assign to target role (if not unassigned)
    if (targetRoleId !== "unassigned") {
      assignUserRole.mutate(
        { userId, roleId: targetRoleId, assignedBy: currentUser.id },
        {
          onSuccess: () => toast.success(t("roles.toast.memberReassigned")),
          onError: (err) => toast.error(t("roles.toast.reassignFailed"), { description: err.message }),
        }
      );
    } else {
      toast.success(t("roles.toast.memberRemoved"));
    }
  }

  return (
    <div className="space-y-1">
      <p className="font-kosugi text-[10px] text-text-disabled">
        {t("roles.boardHint")}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {/* Unassigned column */}
          <RoleAssignmentColumn
            roleId="unassigned"
            roleName={t("roles.unassigned")}
            members={roleMembers.get("unassigned") ?? []}
            isPreset={false}
          />

          {/* Role columns */}
          {roles.map((role) => (
            <RoleAssignmentColumn
              key={role.id}
              roleId={role.id}
              roleName={role.name}
              members={roleMembers.get(role.id) ?? []}
              isPreset={role.isPreset}
              onClickHeader={() => onEditRole(role.id)}
            />
          ))}
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeMember ? (
            <div className="opacity-80 scale-105 shadow-lg px-[10px] py-[6px] bg-background-card border border-ops-accent rounded font-mohave text-[11px] text-text-primary">
              {activeMember.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
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
  role: {
    id: string;
    name: string;
    description: string | null;
    isPreset: boolean;
  };
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
        "flex items-center justify-between py-[10px] border-b border-[rgba(255,255,255,0.04)] last:border-0 relative",
        role.isPreset && "opacity-80",
        menuOpen && "z-40"
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
          {memberCount}{" "}
          {memberCount === 1 ? t("roles.member") : t("roles.members")}
        </span>

        {!role.isPreset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            className="text-text-tertiary"
          >
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
              <div
                className="fixed inset-0 z-30"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full mt-[4px] z-50 min-w-[160px] bg-background-card border border-border rounded-lg shadow-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    onEdit();
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-1.5 py-[8px] font-mohave text-body-sm text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors"
                >
                  {role.isPreset
                    ? t("roles.viewPermissions")
                    : t("roles.editPermissions")}
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
  const [listMode, setListMode] = useState<ListMode>("rows");
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
        onError: (err) =>
          toast.error(t("roles.toast.duplicateFailed"), {
            description: err.message,
          }),
      }
    );
  }

  function handleDelete(roleId: string) {
    deleteRole.mutate(roleId, {
      onSuccess: () => {
        toast.success(t("roles.toast.deleted"));
        setConfirmDelete(null);
      },
      onError: (err) =>
        toast.error(t("roles.toast.deleteFailed"), {
          description: err.message,
        }),
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
          setSelectedRoleId(role.id);
          setView("editor");
        },
        onError: (err) =>
          toast.error(t("roles.toast.createFailed"), {
            description: err.message,
          }),
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
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("roles.title")}</CardTitle>
            <div className="flex items-center gap-1.5">
              {/* List / Board toggle */}
              <div className="flex items-center gap-0">
                <button
                  type="button"
                  onClick={() => setListMode("rows")}
                  title={t("roles.listView")}
                  className={cn(
                    "p-[5px] border transition-colors duration-150 rounded-l",
                    listMode === "rows"
                      ? "bg-ops-accent-muted text-ops-accent border-ops-accent"
                      : "bg-transparent text-text-disabled border-border hover:text-text-tertiary"
                  )}
                >
                  <List className="w-[14px] h-[14px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setListMode("board")}
                  title={t("roles.boardView")}
                  className={cn(
                    "p-[5px] border transition-colors duration-150 rounded-r",
                    listMode === "board"
                      ? "bg-ops-accent-muted text-ops-accent border-ops-accent"
                      : "bg-transparent text-text-disabled border-border hover:text-text-tertiary"
                  )}
                >
                  <LayoutGrid className="w-[14px] h-[14px]" />
                </button>
              </div>

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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCreate(false)}
              >
                <X className="w-[14px] h-[14px]" />
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : listMode === "board" ? (
            <RolesAssignmentBoard
              roles={roles ?? []}
              allUserRoles={allUserRoles ?? []}
              onEditRole={handleEdit}
            />
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
