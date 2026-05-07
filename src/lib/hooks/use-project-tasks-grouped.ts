/**
 * useProjectTasksGrouped — workspace TASKS rail.
 *
 * Reads non-deleted project_tasks for a project, joins task_types for the
 * colored chip, and partitions into { done, active, upcoming }.
 *
 * Real status values from the live DB: 'completed' | 'active' | 'cancelled'.
 *   - completed → done
 *   - cancelled → omitted from groups (and from totals.total)
 *   - active AND start_date <= today AND
 *       (end_date IS NULL OR end_date >= today) → active
 *   - active otherwise → upcoming
 *
 * "Today" is the local-time calendar date — task scheduling uses DATE columns
 * (no timezone), so we compare YYYY-MM-DD strings.
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";

export interface ProjectTaskRow {
  id: string;
  title: string;
  status: "completed" | "active" | "cancelled";
  startDate: string | null;
  endDate: string | null;
  chipColor: string;
  chipLabel: string;
  chipIcon: string | null;
  teamMemberIds: string[];
  displayOrder: number;
}

export interface ProjectTasksGrouped {
  done: ProjectTaskRow[];
  active: ProjectTaskRow[];
  upcoming: ProjectTaskRow[];
  totals: { done: number; total: number };
}

const DEFAULT_CHIP_COLOR = "#6F94B0";
const DEFAULT_CHIP_LABEL = "Task";

interface DbTaskRow {
  id: string;
  custom_title: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  task_type_id: string | null;
  task_color: string | null;
  team_member_ids: string[] | null;
  display_order: number | null;
  task_types: { id: string; display: string; color: string; icon: string | null } | null;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isActiveToday(start: string | null, end: string | null, today: string): boolean {
  if (!start) return false;
  if (start > today) return false;
  if (end && end < today) return false;
  return true;
}

function buildRow(t: DbTaskRow): ProjectTaskRow {
  const chipColor = t.task_types?.color ?? t.task_color ?? DEFAULT_CHIP_COLOR;
  const chipLabel = t.task_types?.display ?? t.custom_title ?? DEFAULT_CHIP_LABEL;
  return {
    id: t.id,
    title: t.custom_title ?? t.task_types?.display ?? "Untitled",
    status: t.status as ProjectTaskRow["status"],
    startDate: t.start_date,
    endDate: t.end_date,
    chipColor,
    chipLabel,
    chipIcon: t.task_types?.icon ?? null,
    teamMemberIds: t.team_member_ids ?? [],
    displayOrder: t.display_order ?? 0,
  };
}

export function useProjectTasksGrouped(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.projectWorkspace.tasksGrouped(projectId),
    queryFn: async (): Promise<ProjectTasksGrouped> => {
      if (!projectId) {
        return { done: [], active: [], upcoming: [], totals: { done: 0, total: 0 } };
      }
      const supabase = requireSupabase();

      const { data, error } = await supabase
        .from("project_tasks")
        .select(
          `
            id, custom_title, status, start_date, end_date,
            task_type_id, task_color, team_member_ids, display_order,
            task_types ( id, display, color, icon )
          `
        )
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("display_order", { ascending: true });

      if (error) throw error;
      const rows = (data ?? []) as unknown as DbTaskRow[];

      const today = todayISO();
      const done: ProjectTaskRow[] = [];
      const active: ProjectTaskRow[] = [];
      const upcoming: ProjectTaskRow[] = [];

      for (const raw of rows) {
        if (raw.status === "cancelled") continue;
        const row = buildRow(raw);
        if (raw.status === "completed") {
          done.push(row);
          continue;
        }
        if (isActiveToday(raw.start_date, raw.end_date, today)) {
          active.push(row);
        } else {
          upcoming.push(row);
        }
      }

      return {
        done,
        active,
        upcoming,
        totals: { done: done.length, total: done.length + active.length + upcoming.length },
      };
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
