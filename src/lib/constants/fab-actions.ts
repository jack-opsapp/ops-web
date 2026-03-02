import {
  Receipt,
  TrendingUp,
  Calculator,
  Users,
  FolderKanban,
  ClipboardList,
  Tag,
} from "lucide-react";
import type React from "react";
import type { FloatingWindowType } from "@/stores/window-store";

export interface FABAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  triggerAction: string;
  handler: "window" | "route";
  target: FloatingWindowType | string;
}

/** Type guard: true when action.target is a valid FloatingWindowType */
export function isWindowAction(action: FABAction): action is FABAction & { target: FloatingWindowType } {
  return action.handler === "window";
}

export const ALL_ACTIONS: FABAction[] = [
  { id: "expense",   label: "Add Expense",   icon: Receipt,       triggerAction: "expenses",   handler: "route",  target: "/expenses?action=new" },
  { id: "lead",      label: "New Lead",      icon: TrendingUp,    triggerAction: "leads",      handler: "route",  target: "/pipeline?action=new" },
  { id: "estimate",  label: "New Estimate",  icon: Calculator,    triggerAction: "estimates",  handler: "route",  target: "/estimates?action=new" },
  { id: "client",    label: "New Client",    icon: Users,         triggerAction: "clients",    handler: "window", target: "create-client" },
  { id: "project",   label: "New Project",   icon: FolderKanban,  triggerAction: "projects",   handler: "window", target: "create-project" },
  { id: "task",      label: "New Task",      icon: ClipboardList, triggerAction: "tasks",      handler: "window", target: "create-task" },
  { id: "task-type", label: "New Task Type", icon: Tag,           triggerAction: "task-types", handler: "route",  target: "/settings?tab=company" },
];

export const DEFAULT_ACTION_IDS = ALL_ACTIONS.map((a) => a.id);
