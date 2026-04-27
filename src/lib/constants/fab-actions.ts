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
import type { FloatingWindowType } from "@/stores/window-store";

export interface FABAction {
  id: string;
  label: string;
  /** 3-letter uppercase mono code shown right-aligned in the Quick Actions drawer (e.g. "EXP", "LED"). */
  hintCode: string;
  icon: React.ComponentType<{ className?: string }>;
  triggerAction: string;
  handler: "window" | "route";
  target: FloatingWindowType | string;
  requiredPermission?: string;
}

/** Type guard: true when action.target is a valid FloatingWindowType */
export function isWindowAction(action: FABAction): action is FABAction & { target: FloatingWindowType } {
  return action.handler === "window";
}

export const ALL_ACTIONS: FABAction[] = [
  { id: "expense",        label: "Add Expense",   hintCode: "EXP", icon: Receipt,       triggerAction: "expenses",   handler: "route",  target: "/accounting?tab=expenses", requiredPermission: "expenses.create" },
  { id: "lead",           label: "New Lead",      hintCode: "LED", icon: TrendingUp,    triggerAction: "leads",      handler: "window", target: "create-lead",              requiredPermission: "pipeline.manage" },
  { id: "estimate",       label: "New Estimate",  hintCode: "EST", icon: Calculator,    triggerAction: "estimates",  handler: "window", target: "create-estimate",          requiredPermission: "estimates.create" },
  { id: "invoice",        label: "New Invoice",   hintCode: "INV", icon: FileText,      triggerAction: "invoices",   handler: "route",  target: "/invoices?action=new",     requiredPermission: "invoices.create" },
  { id: "client",         label: "New Client",    hintCode: "CLI", icon: Users,         triggerAction: "clients",    handler: "window", target: "create-client",            requiredPermission: "clients.create" },
  { id: "project",        label: "New Project",   hintCode: "PRJ", icon: FolderKanban,  triggerAction: "projects",   handler: "window", target: "create-project",           requiredPermission: "projects.create" },
  { id: "task",           label: "New Task",      hintCode: "TSK", icon: ClipboardList, triggerAction: "tasks",      handler: "window", target: "create-task",              requiredPermission: "tasks.create" },
  { id: "task-type",      label: "New Task Type", hintCode: "TTY", icon: Tag,           triggerAction: "task-types", handler: "route",  target: "/settings?tab=company",    requiredPermission: "settings.company" },
  { id: "inventory-item", label: "New Item",      hintCode: "ITM", icon: Boxes,         triggerAction: "inventory",  handler: "route",  target: "/inventory?action=new",    requiredPermission: "inventory.manage" },
];

export const DEFAULT_ACTION_IDS = ALL_ACTIONS.map((a) => a.id);
