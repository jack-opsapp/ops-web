"use client";

/**
 * Project Deductions Tab — read-only audit trail of every inventory
 * deduction (and reversal) logged for a project.
 */

import { useMemo } from "react";
import { format } from "date-fns";
import { useProjectDeductions } from "@/lib/hooks";
import { useInventoryItems } from "@/lib/hooks/use-inventory";
import { useTeamMembers, useProjectTasks } from "@/lib/hooks";
import type { Project } from "@/lib/types/models";
import type { InventoryItem } from "@/lib/types/inventory";
import type { InventoryDeduction } from "@/lib/types/product-materials";
import { cn } from "@/lib/utils/cn";
import { getTaskDisplayTitle } from "@/lib/types/models";

interface Props {
  project: Project;
}

const REASON_LABEL: Record<InventoryDeduction["reason"], string> = {
  task_completion: "Task completed",
  task_reopened: "Reversal",
  manual_adjustment: "Manual",
  skipped_archived: "Skipped (archived)",
};

export function ProjectDeductionsTab({ project }: Props) {
  const { data: deductions = [], isLoading } = useProjectDeductions(project.id);
  const { data: inventory = [] } = useInventoryItems();
  const { data: teamResult } = useTeamMembers();
  const { data: tasks = [] } = useProjectTasks(project.id);

  const itemMap = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    inventory.forEach((i: InventoryItem) => m.set(i.id, i));
    return m;
  }, [inventory]);

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    (teamResult?.users ?? []).forEach((u) =>
      m.set(u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unknown")
    );
    return m;
  }, [teamResult]);

  const taskMap = useMemo(() => {
    const m = new Map<string, string>();
    tasks.forEach((t) => m.set(t.id, getTaskDisplayTitle(t, t.taskType)));
    return m;
  }, [tasks]);

  if (isLoading) {
    return (
      <p className="font-kosugi text-caption text-text-mute">
        Loading deductions...
      </p>
    );
  }

  if (deductions.length === 0) {
    return (
      <div className="border border-border rounded p-6 text-center">
        <p className="font-kosugi text-caption text-text-mute">
          [no inventory movements yet — deductions post automatically when tasks complete]
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mohave text-heading-sm uppercase tracking-wider text-text">
          Inventory Movements
        </h3>
        <span className="font-kosugi text-caption-sm text-text-3">
          [{deductions.length} record{deductions.length !== 1 ? "s" : ""}]
        </span>
      </div>

      <div className="border border-border rounded overflow-hidden">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-border bg-[rgba(255,255,255,0.02)]">
              <th className="text-left px-3 py-2 font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
                Date
              </th>
              <th className="text-left px-3 py-2 font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
                Item
              </th>
              <th className="text-left px-3 py-2 font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
                Task
              </th>
              <th className="text-right px-3 py-2 font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
                Qty
              </th>
              <th className="text-right px-3 py-2 font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
                Before → After
              </th>
              <th className="text-left px-3 py-2 font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
                Reason
              </th>
              <th className="text-left px-3 py-2 font-kosugi text-caption-sm text-text-3 uppercase tracking-widest">
                By
              </th>
            </tr>
          </thead>
          <tbody>
            {deductions.map((d) => {
              const item = d.inventoryItemId ? itemMap.get(d.inventoryItemId) : null;
              const taskTitle = d.taskId ? taskMap.get(d.taskId) : null;
              const byName = d.deductedBy ? userMap.get(d.deductedBy) : null;
              const isReversal = d.reason === "task_reopened";
              const isSkipped = d.reason === "skipped_archived";

              return (
                <tr
                  key={d.id}
                  className={cn(
                    "border-b border-border last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors",
                    isReversal && "opacity-70"
                  )}
                >
                  <td className="px-3 py-1.5 font-mono text-data-sm text-text-3 whitespace-nowrap">
                    {format(d.deductedAt, "MMM d, HH:mm")}
                  </td>
                  <td className="px-3 py-1.5 font-mohave text-body text-text">
                    {item?.name ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 font-kosugi text-caption text-text-2 truncate max-w-[200px]">
                    {taskTitle ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-data-sm">
                    <span
                      className={cn(
                        isReversal ? "text-status-success" : "text-text",
                        isSkipped && "text-text-mute"
                      )}
                    >
                      {isReversal ? "+" : isSkipped ? "" : "-"}
                      {d.quantityDeducted}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-data-sm text-text-3 whitespace-nowrap">
                    {d.previousQuantity} → {d.newQuantity}
                  </td>
                  <td className="px-3 py-1.5 font-kosugi text-caption text-text-2">
                    {REASON_LABEL[d.reason]}
                  </td>
                  <td className="px-3 py-1.5 font-kosugi text-caption text-text-3 truncate max-w-[120px]">
                    {byName ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
