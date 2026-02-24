"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, RotateCcw, Plus, Minus, ChevronDown, ChevronRight } from "lucide-react";
import {
  FolderKanban,
  CalendarDays,
  Users,
  DollarSign,
  UserCheck,
  ClipboardCheck,
  ListTodo,
  GitBranch,
  TrendingUp,
  Activity,
  AlertTriangle,
  FileText,
  Calculator,
  Target,
  CreditCard,
  Receipt,
  Clock,
  MapPin,
  List,
  BarChart3,
  Gauge,
  PieChart,
  Contact,
  MessageSquare,
  AlertCircle,
  Bell,
  Filter,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  WIDGET_TYPE_REGISTRY,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  WIDGET_SIZE_LABELS,
  type WidgetTypeId,
  type WidgetSize,
  type WidgetCategory,
  type WidgetTag,
  type WidgetConfigField,
  type WidgetInstance,
  getDefaultConfig,
} from "@/lib/types/dashboard-widgets";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------
const ICON_MAP: Record<string, LucideIcon> = {
  FolderKanban,
  CalendarDays,
  Users,
  DollarSign,
  UserCheck,
  ClipboardCheck,
  ListTodo,
  GitBranch,
  TrendingUp,
  Activity,
  AlertTriangle,
  FileText,
  Calculator,
  Target,
  CreditCard,
  Receipt,
  Clock,
  MapPin,
  List,
  BarChart3,
  Gauge,
  PieChart,
  Contact,
  MessageSquare,
  AlertCircle,
  Bell,
  Filter,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface WidgetSidebarProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function WidgetSidebar({ open, onClose }: WidgetSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<WidgetCategory>>(
    new Set(CATEGORY_ORDER)
  );

  const widgetInstances = usePreferencesStore((s) => s.widgetInstances);
  const addWidgetInstance = usePreferencesStore((s) => s.addWidgetInstance);
  const removeWidgetInstance = usePreferencesStore((s) => s.removeWidgetInstance);
  const updateWidgetInstance = usePreferencesStore((s) => s.updateWidgetInstance);
  const resetWidgetInstances = usePreferencesStore((s) => s.resetWidgetInstances);

  const toggleCategory = useCallback((category: WidgetCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  // Count instances per type
  const instanceCountByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const inst of widgetInstances) {
      counts[inst.typeId] = (counts[inst.typeId] || 0) + 1;
    }
    return counts;
  }, [widgetInstances]);

  // Get instances for a specific type
  const getInstancesForType = useCallback(
    (typeId: WidgetTypeId): WidgetInstance[] =>
      widgetInstances.filter((i: WidgetInstance) => i.typeId === typeId),
    [widgetInstances]
  );

  // Group widget types by category, filtered by search
  const groupedTypes = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const groups: Record<WidgetCategory, WidgetTypeId[]> = {} as Record<WidgetCategory, WidgetTypeId[]>;

    for (const cat of CATEGORY_ORDER) {
      groups[cat] = [];
    }

    for (const [id, entry] of Object.entries(WIDGET_TYPE_REGISTRY)) {
      const typeId = id as WidgetTypeId;

      // Filter by search
      if (query) {
        const matchesLabel = entry.label.toLowerCase().includes(query);
        const matchesDescription = entry.description.toLowerCase().includes(query);
        const matchesTags = entry.tags.some((tag: WidgetTag) => tag.toLowerCase().includes(query));
        const matchesCategory = CATEGORY_LABELS[entry.category].toLowerCase().includes(query);
        if (!matchesLabel && !matchesDescription && !matchesTags && !matchesCategory) continue;
      }

      groups[entry.category].push(typeId);
    }

    return groups;
  }, [searchQuery]);

  // Categories with at least one widget type
  const visibleCategories = useMemo(
    () => CATEGORY_ORDER.filter((cat) => groupedTypes[cat].length > 0),
    [groupedTypes]
  );

  // Total active widget count
  const totalActiveCount = widgetInstances.filter((i: WidgetInstance) => i.visible).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={onClose}
          />

          {/* Sidebar panel */}
          <motion.div
            initial={{ x: -360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -360, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_SMOOTH }}
            className="fixed left-0 top-0 bottom-0 w-[360px] bg-background-panel border-r border-border z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
              <div>
                <h2 className="font-mohave text-body-lg text-text-primary font-medium">Widget Catalog</h2>
                <span className="font-mono text-[10px] text-text-disabled">
                  {totalActiveCount} active
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-[4px] rounded-sm text-text-disabled hover:text-text-secondary transition-colors"
              >
                <X className="w-[16px] h-[16px]" />
              </button>
            </div>

            {/* Search */}
            <div className="px-2 py-1.5 border-b border-border shrink-0">
              <div className="relative">
                <Search className="absolute left-[8px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-disabled" />
                <input
                  type="text"
                  placeholder="Search widgets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-[28px] pr-[8px] py-[6px] rounded bg-background-input border border-border-input text-text-primary font-mohave text-body-sm placeholder:text-text-placeholder focus:border-border-medium focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Widget type list */}
            <div className="flex-1 overflow-y-auto min-h-0 px-2 py-1.5">
              {visibleCategories.length === 0 ? (
                <p className="font-mohave text-body-sm text-text-disabled py-3 text-center">
                  No widgets match your search
                </p>
              ) : (
                <div className="space-y-1">
                  {visibleCategories.map((category, catIdx) => {
                    const isExpanded = expandedCategories.has(category);
                    return (
                      <motion.div
                        key={category}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: catIdx * 0.04, duration: 0.2, ease: EASE_SMOOTH }}
                      >
                        {/* Category header — clickable to collapse */}
                        <button
                          onClick={() => toggleCategory(category)}
                          className="flex items-center gap-[6px] w-full py-[6px] group"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-[10px] h-[10px] text-text-disabled" />
                          ) : (
                            <ChevronRight className="w-[10px] h-[10px] text-text-disabled" />
                          )}
                          <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                            {CATEGORY_LABELS[category]}
                          </span>
                          <span className="font-mono text-[9px] text-text-disabled ml-auto">
                            {groupedTypes[category].length}
                          </span>
                        </button>

                        {/* Widget type items */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                              className="overflow-hidden"
                            >
                              <div className="space-y-[2px] pb-1">
                                {groupedTypes[category].map((typeId) => (
                                  <WidgetTypeItem
                                    key={typeId}
                                    typeId={typeId}
                                    instanceCount={instanceCountByType[typeId] || 0}
                                    instances={getInstancesForType(typeId)}
                                    onAdd={(config) => addWidgetInstance(typeId, config)}
                                    onRemove={removeWidgetInstance}
                                    onUpdateInstance={updateWidgetInstance}
                                  />
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-2 py-1.5 border-t border-border shrink-0">
              <button
                onClick={resetWidgetInstances}
                className="flex items-center gap-[6px] font-mohave text-body-sm text-text-disabled hover:text-text-secondary transition-colors w-full justify-center py-[4px]"
              >
                <RotateCcw className="w-[12px] h-[12px]" />
                Reset to defaults
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Widget type item — shows type info + add/remove controls + instances
// ---------------------------------------------------------------------------
function WidgetTypeItem({
  typeId,
  instanceCount,
  instances,
  onAdd,
  onRemove,
  onUpdateInstance,
}: {
  typeId: WidgetTypeId;
  instanceCount: number;
  instances: WidgetInstance[];
  onAdd: (config?: Record<string, unknown>) => void;
  onRemove: (instanceId: string) => void;
  onUpdateInstance: (instanceId: string, updates: Partial<Pick<WidgetInstance, "size" | "visible" | "config">>) => void;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const entry = WIDGET_TYPE_REGISTRY[typeId];
  if (!entry) return null;

  const Icon = ICON_MAP[entry.icon] ?? Activity;
  const isAdded = instanceCount > 0;
  const canAddMore = entry.allowMultiple || instanceCount === 0;
  const hasMultipleSizes = entry.supportedSizes.length > 1;

  return (
    <div className="rounded hover:bg-[rgba(255,255,255,0.03)] transition-colors">
      {/* Main row */}
      <div className="flex items-center gap-1.5 px-[6px] py-[6px]">
        {/* Icon */}
        <div
          className={cn(
            "w-[28px] h-[28px] rounded flex items-center justify-center shrink-0",
            isAdded ? "bg-ops-accent/10" : "bg-[rgba(255,255,255,0.05)]"
          )}
        >
          <Icon
            className={cn(
              "w-[14px] h-[14px]",
              isAdded ? "text-ops-accent" : "text-text-secondary"
            )}
          />
        </div>

        {/* Label + description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[6px]">
            <p className="font-mohave text-body-sm text-text-primary truncate">{entry.label}</p>
            {entry.allowMultiple && instanceCount > 0 && (
              <span className="font-mono text-[9px] px-[4px] py-[1px] rounded bg-ops-accent/15 text-ops-accent">
                {instanceCount}x
              </span>
            )}
          </div>
          <p className="font-mono text-[9px] text-text-disabled truncate">{entry.description}</p>
        </div>

        {/* Add / Remove buttons */}
        <div className="flex items-center gap-[3px] shrink-0">
          {/* Config toggle for types with config */}
          {entry.configSchema.length > 0 && isAdded && (
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={cn(
                "p-[3px] rounded-sm font-mono text-[9px] border transition-all duration-150",
                showConfig
                  ? "bg-ops-accent-muted border-ops-accent text-text-primary"
                  : "bg-transparent text-text-disabled border-transparent hover:border-border-medium"
              )}
              title="Configure"
            >
              <ChevronDown className={cn("w-[10px] h-[10px] transition-transform", showConfig && "rotate-180")} />
            </button>
          )}

          {/* Remove one instance (for multi-instance, removes latest) */}
          {isAdded && (
            <button
              onClick={() => {
                const lastInstance = instances[instances.length - 1];
                if (lastInstance) onRemove(lastInstance.id);
              }}
              className="p-[3px] rounded-sm bg-transparent text-text-disabled hover:text-ops-error border border-transparent hover:border-ops-error/30 transition-all duration-150"
              title={`Remove ${entry.label}`}
            >
              <Minus className="w-[12px] h-[12px]" />
            </button>
          )}

          {/* Add button */}
          {canAddMore && (
            <button
              onClick={() => onAdd()}
              className={cn(
                "p-[3px] rounded-sm border transition-all duration-150",
                isAdded
                  ? "bg-transparent text-ops-accent border-transparent hover:border-ops-accent/30"
                  : "bg-ops-accent/10 text-ops-accent border-ops-accent/20 hover:bg-ops-accent/20"
              )}
              title={`Add ${entry.label}`}
            >
              <Plus className="w-[12px] h-[12px]" />
            </button>
          )}
        </div>
      </div>

      {/* Instance config panels */}
      <AnimatePresence>
        {showConfig && instances.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE_SMOOTH }}
            className="overflow-hidden"
          >
            <div className="px-[6px] pb-[6px] space-y-[4px]">
              {instances.map((instance, idx) => (
                <InstanceConfigPanel
                  key={instance.id}
                  instance={instance}
                  instanceLabel={instances.length > 1 ? `#${idx + 1}` : undefined}
                  configSchema={entry.configSchema}
                  supportedSizes={entry.supportedSizes}
                  hasMultipleSizes={hasMultipleSizes}
                  onUpdate={(updates) => onUpdateInstance(instance.id, updates)}
                  onRemove={() => onRemove(instance.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instance config panel — per-instance size + config fields
// ---------------------------------------------------------------------------
function InstanceConfigPanel({
  instance,
  instanceLabel,
  configSchema,
  supportedSizes,
  hasMultipleSizes,
  onUpdate,
  onRemove,
}: {
  instance: WidgetInstance;
  instanceLabel?: string;
  configSchema: WidgetConfigField[];
  supportedSizes: WidgetSize[];
  hasMultipleSizes: boolean;
  onUpdate: (updates: Partial<Pick<WidgetInstance, "size" | "visible" | "config">>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-[rgba(255,255,255,0.02)] rounded border border-border-subtle p-[6px] space-y-[6px]">
      {/* Instance header */}
      <div className="flex items-center justify-between">
        {instanceLabel && (
          <span className="font-mono text-[9px] text-text-disabled">Instance {instanceLabel}</span>
        )}

        {/* Size pills */}
        {hasMultipleSizes && (
          <div className="flex items-center gap-[2px]">
            {supportedSizes.map((s: WidgetSize) => (
              <button
                key={s}
                onClick={() => onUpdate({ size: s })}
                className={cn(
                  "px-[5px] py-[1px] rounded-sm font-mono text-[9px] border transition-all duration-150",
                  instance.size === s
                    ? "bg-ops-accent-muted border-ops-accent text-text-primary"
                    : "bg-transparent text-text-disabled border-transparent hover:border-border-medium"
                )}
              >
                {WIDGET_SIZE_LABELS[s]}
              </button>
            ))}
          </div>
        )}

        {/* Visibility toggle */}
        <button
          onClick={() => onUpdate({ visible: !instance.visible })}
          className={cn(
            "relative w-[28px] h-[16px] rounded-full transition-colors duration-200 shrink-0",
            instance.visible ? "bg-ops-accent" : "bg-[rgba(255,255,255,0.1)]"
          )}
        >
          <span
            className={cn(
              "absolute top-[2px] w-[12px] h-[12px] rounded-full bg-white transition-transform duration-200",
              instance.visible ? "translate-x-[14px]" : "translate-x-[2px]"
            )}
          />
        </button>
      </div>

      {/* Config fields */}
      {configSchema.map((field: WidgetConfigField) => {
        if (field.type === "select" && field.options) {
          return (
            <div key={field.key} className="flex items-center gap-[6px]">
              <label className="font-mono text-[9px] text-text-disabled shrink-0 w-[40px]">
                {field.label}
              </label>
              <select
                value={String(instance.config[field.key] ?? field.defaultValue)}
                onChange={(e) => onUpdate({ config: { [field.key]: e.target.value } })}
                className="flex-1 bg-background-input border border-border-input rounded px-[6px] py-[3px] font-mono text-[10px] text-text-primary focus:border-border-medium focus:outline-none appearance-none cursor-pointer"
              >
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (field.type === "toggle") {
          return (
            <div key={field.key} className="flex items-center justify-between">
              <label className="font-mono text-[9px] text-text-disabled">
                {field.label}
              </label>
              <button
                onClick={() => onUpdate({ config: { [field.key]: !instance.config[field.key] } })}
                className={cn(
                  "relative w-[28px] h-[16px] rounded-full transition-colors duration-200",
                  instance.config[field.key] ? "bg-ops-accent" : "bg-[rgba(255,255,255,0.1)]"
                )}
              >
                <span
                  className={cn(
                    "absolute top-[2px] w-[12px] h-[12px] rounded-full bg-white transition-transform duration-200",
                    instance.config[field.key] ? "translate-x-[14px]" : "translate-x-[2px]"
                  )}
                />
              </button>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
