import {
  Receipt,
  TrendingUp,
  Calculator,
  Users,
  FolderKanban,
  ClipboardList,
  Tag,
  Boxes,
  FileText,
} from "lucide-react";
import type React from "react";
import type {
  FloatingWindowType,
  ProjectWorkspaceMode,
} from "@/stores/window-store";

export interface FABAction {
  id: string;
  /**
   * i18n dictionary key under the `quick-actions` namespace. Resolves to the
   * tactical-voice action label (e.g. "actions.expense.label" -> "ADD EXPENSE").
   * All production `ALL_ACTIONS` entries set this; consumers should read via
   * `useDictionary("quick-actions").t(action.labelKey)`. Optional only to
   * permit pre-i18n test fixtures (which fall back to `label`).
   */
  labelKey?: string;
  /**
   * @deprecated Legacy literal label retained only so older test fixtures keep
   * type-checking and as the dictionary fallback. Production consumers must
   * prefer `labelKey` via the dictionary.
   */
  label?: string;
  /** 3-letter uppercase mono code shown right-aligned in the Quick Actions drawer (e.g. "EXP", "LED"). */
  hintCode: string;
  icon: React.ComponentType<{ className?: string }>;
  triggerAction: string;
  handler: "window" | "route";
  target: FloatingWindowType | string;
  requiredPermission?: string;
  /**
   * Optional metadata passed to the open dispatcher. Currently only the
   * project-workspace action uses it (initialMode = "creating"); other
   * actions leave this undefined.
   */
  meta?: { initialMode?: ProjectWorkspaceMode };
}

/** Type guard: true when action.target is a valid FloatingWindowType */
export function isWindowAction(action: FABAction): action is FABAction & { target: FloatingWindowType } {
  return action.handler === "window";
}

/**
 * Resolve an action's display label. Pass a translator (`t` from
 * `useDictionary("quick-actions")`) to render the dictionary value; if no
 * translator is supplied, or no `labelKey` is set, the legacy `label` is used.
 * Returns an empty string if neither is available.
 */
export function resolveActionLabel(
  action: FABAction,
  t?: (key: string) => string,
): string {
  if (action.labelKey && t) return t(action.labelKey);
  return action.label ?? "";
}

export const ALL_ACTIONS: FABAction[] = [
  { id: "expense",        labelKey: "actions.expense.label",       hintCode: "EXP", icon: Receipt,       triggerAction: "expenses",   handler: "route",  target: "/accounting?tab=expenses", requiredPermission: "expenses.create" },
  { id: "lead",           labelKey: "actions.lead.label",          hintCode: "LED", icon: TrendingUp,    triggerAction: "leads",      handler: "window", target: "create-lead",              requiredPermission: "pipeline.manage" },
  { id: "estimate",       labelKey: "actions.estimate.label",      hintCode: "EST", icon: Calculator,    triggerAction: "estimates",  handler: "window", target: "create-estimate",          requiredPermission: "estimates.create" },
  { id: "invoice",        labelKey: "actions.invoice.label",       hintCode: "INV", icon: FileText,      triggerAction: "invoices",   handler: "route",  target: "/invoices?action=new",     requiredPermission: "invoices.create" },
  { id: "client",         labelKey: "actions.client.label",        hintCode: "CLI", icon: Users,         triggerAction: "clients",    handler: "window", target: "create-client",            requiredPermission: "clients.create" },
  // Phase 9.1 — "New Project" routes through the unified workspace
  // window in creating mode instead of the legacy create-project modal.
  { id: "project",        labelKey: "actions.project.label",       hintCode: "PRJ", icon: FolderKanban,  triggerAction: "projects",   handler: "window", target: "project-workspace",        requiredPermission: "projects.create", meta: { initialMode: "creating" } },
  { id: "task",           labelKey: "actions.task.label",          hintCode: "TSK", icon: ClipboardList, triggerAction: "tasks",      handler: "window", target: "create-task",              requiredPermission: "tasks.create" },
  { id: "task-type",      labelKey: "actions.task-type.label",     hintCode: "TTY", icon: Tag,           triggerAction: "task-types", handler: "route",  target: "/settings?tab=company",    requiredPermission: "settings.company" },
  { id: "inventory-item", labelKey: "actions.inventory-item.label",hintCode: "ITM", icon: Boxes,         triggerAction: "inventory",  handler: "route",  target: "/inventory?action=new",    requiredPermission: "inventory.manage" },
];

export const DEFAULT_ACTION_IDS = ALL_ACTIONS.map((a) => a.id);
