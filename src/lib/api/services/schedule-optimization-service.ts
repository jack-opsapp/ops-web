/**
 * OPS Web — Schedule Optimization Service
 *
 * Sprint S1.1: Analyzes daily schedules and suggests optimizations.
 * Computes travel distances via Haversine, detects conflicts,
 * identifies unassigned tasks, and handles reschedule cascades.
 *
 * Builds on AssignmentService (P2.2) — uses suggestAssignment for
 * unassigned task recommendations.
 *
 * All suggestions flow through the approval queue — nothing is auto-applied.
 * Gated behind phase_c feature flag.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { parseStringArray } from "@/lib/utils/parse";
import { ApprovalQueueService } from "./approval-queue-service";
import { AssignmentService } from "./assignment-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import type {
  OptimizeScheduleActionData,
  RescheduleTasksActionData,
  ScheduleOptimizationSettings,
} from "@/lib/types/approval-queue";
import { DEFAULT_SCHEDULE_SETTINGS } from "@/lib/types/approval-queue";

// ─── Haversine Distance ──────────────────────────────────────────────────────

/**
 * Straight-line distance between two coordinates in kilometers.
 * Sufficient for "this stop is closer than that stop" decisions.
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Compute total route distance for an ordered list of coordinates.
 */
function computeRouteDistance(
  coords: Array<{ lat: number; lng: number }>
): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistance(
      coords[i - 1].lat,
      coords[i - 1].lng,
      coords[i].lat,
      coords[i].lng
    );
  }
  return Math.round(total * 10) / 10;
}

/**
 * Nearest-neighbor heuristic for route optimization.
 * Starts from the first stop and greedily picks the closest unvisited stop.
 */
function nearestNeighborOrder<T extends { lat: number; lng: number }>(
  stops: T[]
): T[] {
  if (stops.length <= 2) return [...stops];

  const result: T[] = [stops[0]];
  const remaining = stops.slice(1);

  while (remaining.length > 0) {
    const current = result[result.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(
        current.lat,
        current.lng,
        remaining[i].lat,
        remaining[i].lng
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    result.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return result;
}

// ─── Return Types ────────────────────────────────────────────────────────────

interface TaskWithProject {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  duration: number;
  teamMemberIds: string[];
  status: string;
  displayOrder: number;
  taskTypeId: string | null;
}

interface MemberSchedule {
  memberId: string;
  memberName: string;
  tasks: Array<TaskWithProject & { distanceFromPrev: number }>;
  totalDistance: number;
  conflicts: Array<{
    task1Id: string;
    task1Title: string;
    task2Id: string;
    task2Title: string;
    overlapStart: string;
    overlapEnd: string;
  }>;
}

interface DailyScheduleResult {
  date: string;
  memberSchedules: MemberSchedule[];
  unassignedTasks: TaskWithProject[];
  optimizationSuggestions: Array<{
    type: "route_reorder" | "conflict" | "unassigned";
    memberId?: string;
    memberName?: string;
    details: Record<string, unknown>;
  }>;
}

interface WeatherAwareness {
  weatherRisk: boolean;
  riskLevel: "low" | "medium" | "high";
  reason: { type: string; params: Record<string, string | number> };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getUserName(row: Record<string, unknown>): string {
  const first = (row.first_name as string) ?? "";
  const last = (row.last_name as string) ?? "";
  return `${first} ${last}`.trim() || "Unknown";
}

/**
 * Structured summary object — used in action_data.context_summary_structured
 * and rendered to a default English string for context_summary (the DB column
 * is plain text; the structured form is what the UI should read).
 *
 * The string form is only used for notification previews and non-i18n logs.
 */
interface StructuredSummary {
  type: string;
  params: Record<string, string | number>;
}

function buildContextSummary(s: StructuredSummary): string {
  // Default English rendering — UI renders its own translation via t("summary.<type>")
  const p = s.params;
  switch (s.type) {
    case "route_reorder":
      return `Reorder ${p.memberName}'s route on ${p.date} — saves ~${p.distanceSaved} km`;
    case "schedule_conflict":
      return `${p.memberName} has overlapping tasks: "${p.task1}" and "${p.task2}" on ${p.date}`;
    case "unassigned_task":
      return p.suggestedMember
        ? `"${p.taskTitle}" has no crew assigned — suggest ${p.suggestedMember}`
        : `"${p.taskTitle}" has no crew assigned`;
    case "cascade_impact":
      return `Rescheduling "${p.sourceTask}" affects "${p.affectedTask}"`;
    default:
      return s.type;
  }
}

/** Load schedule settings from company JSONB, falling back to defaults */
async function loadScheduleSettings(
  companyId: string
): Promise<ScheduleOptimizationSettings> {
  const supabase = requireSupabase();
  const { data } = await supabase
    .from("companies")
    .select("schedule_settings")
    .eq("id", companyId)
    .single();

  const raw = data?.schedule_settings as Record<string, unknown> | null;
  if (!raw) return DEFAULT_SCHEDULE_SETTINGS;

  return {
    enabled:
      typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SCHEDULE_SETTINGS.enabled,
    optimization_window_days:
      typeof raw.optimization_window_days === "number"
        ? raw.optimization_window_days
        : DEFAULT_SCHEDULE_SETTINGS.optimization_window_days,
    travel_optimization:
      typeof raw.travel_optimization === "boolean"
        ? raw.travel_optimization
        : DEFAULT_SCHEDULE_SETTINGS.travel_optimization,
    conflict_detection:
      typeof raw.conflict_detection === "boolean"
        ? raw.conflict_detection
        : DEFAULT_SCHEDULE_SETTINGS.conflict_detection,
    weather_awareness:
      typeof raw.weather_awareness === "boolean"
        ? raw.weather_awareness
        : DEFAULT_SCHEDULE_SETTINGS.weather_awareness,
    climate_zone:
      raw.climate_zone === "northern" || raw.climate_zone === "southern" || raw.climate_zone === "auto"
        ? raw.climate_zone
        : DEFAULT_SCHEDULE_SETTINGS.climate_zone,
    cascade_detection:
      typeof raw.cascade_detection === "boolean"
        ? raw.cascade_detection
        : DEFAULT_SCHEDULE_SETTINGS.cascade_detection,
    outdoor_task_type_ids: Array.isArray(raw.outdoor_task_type_ids)
      ? (raw.outdoor_task_type_ids as string[])
      : DEFAULT_SCHEDULE_SETTINGS.outdoor_task_type_ids,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const ScheduleOptimizationService = {
  /**
   * Analyze the daily schedule for a company on a given date.
   * Fetches all tasks, groups by team member, computes route distances,
   * and identifies conflicts and unassigned tasks.
   */
  async optimizeDailySchedule(
    companyId: string,
    date: Date
  ): Promise<DailyScheduleResult> {
    const supabase = requireSupabase();
    const dateStr = formatDateStr(date);

    // 1. Fetch all tasks scheduled for this date
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    const { data: rawTasks, error: tasksErr } = await supabase
      .from("project_tasks")
      .select(
        "id, custom_title, project_id, start_date, end_date, start_time, end_time, duration, team_member_ids, status, display_order, task_type_id"
      )
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .gte("start_date", dayStart)
      .lte("start_date", dayEnd)
      .order("start_time", { ascending: true, nullsFirst: false })
      .limit(500);

    if (tasksErr) {
      console.error(
        "[schedule-optimization] optimizeDailySchedule tasks fetch:",
        tasksErr.message
      );
    }

    const tasks = rawTasks ?? [];
    if (tasks.length === 0) {
      return {
        date: dateStr,
        memberSchedules: [],
        unassignedTasks: [],
        optimizationSuggestions: [],
      };
    }

    // 2. Fetch projects for addresses and lat/lng (company_id scoped)
    const projectIds = [
      ...new Set(tasks.map((t) => t.project_id as string).filter(Boolean)),
    ];
    const projectMap = new Map<
      string,
      {
        title: string;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
      }
    >();

    for (let i = 0; i < projectIds.length; i += 80) {
      const chunk = projectIds.slice(i, i + 80);
      const { data: projects, error: projErr } = await supabase
        .from("projects")
        .select("id, title, address, latitude, longitude")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .in("id", chunk);

      if (projErr) {
        console.error(
          "[schedule-optimization] optimizeDailySchedule projects fetch:",
          projErr.message
        );
        continue;
      }

      for (const p of projects ?? []) {
        projectMap.set(p.id as string, {
          title: (p.title as string) ?? "Unknown",
          address: (p.address as string) ?? null,
          latitude: (p.latitude as number) ?? null,
          longitude: (p.longitude as number) ?? null,
        });
      }
    }

    // 3. Build enriched task list
    const enrichedTasks: TaskWithProject[] = tasks.map((t) => {
      const proj = projectMap.get(t.project_id as string);
      return {
        taskId: t.id as string,
        taskTitle: (t.custom_title as string) ?? proj?.title ?? "Untitled",
        projectId: t.project_id as string,
        projectName: proj?.title ?? "Unknown",
        address: proj?.address ?? null,
        latitude: proj?.latitude ?? null,
        longitude: proj?.longitude ?? null,
        startDate: (t.start_date as string) ?? null,
        endDate: (t.end_date as string) ?? null,
        startTime: (t.start_time as string) ?? null,
        endTime: (t.end_time as string) ?? null,
        duration: (t.duration as number) ?? 1,
        teamMemberIds: parseStringArray(t.team_member_ids),
        status: t.status as string,
        displayOrder: (t.display_order as number) ?? 0,
        taskTypeId: (t.task_type_id as string) ?? null,
      };
    });

    // 4. Fetch active team members for name lookup
    const allMemberIds = new Set<string>();
    for (const task of enrichedTasks) {
      for (const id of task.teamMemberIds) {
        allMemberIds.add(id);
      }
    }

    const memberNameMap = new Map<string, string>();
    if (allMemberIds.size > 0) {
      const memberIdArr = Array.from(allMemberIds);
      for (let i = 0; i < memberIdArr.length; i += 80) {
        const chunk = memberIdArr.slice(i, i + 80);
        const { data: members, error: membersErr } = await supabase
          .from("users")
          .select("id, first_name, last_name")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .in("id", chunk);

        if (membersErr) {
          console.error(
            "[schedule-optimization] optimizeDailySchedule members fetch:",
            membersErr.message
          );
          continue;
        }

        for (const m of members ?? []) {
          memberNameMap.set(
            m.id as string,
            getUserName(m as Record<string, unknown>)
          );
        }
      }
    }

    // 5. Separate unassigned vs assigned
    const unassignedTasks = enrichedTasks.filter(
      (t) => t.teamMemberIds.length === 0
    );

    // 6. Group assigned tasks by team member
    const memberTaskMap = new Map<string, TaskWithProject[]>();
    for (const task of enrichedTasks) {
      for (const memberId of task.teamMemberIds) {
        if (!memberTaskMap.has(memberId)) {
          memberTaskMap.set(memberId, []);
        }
        memberTaskMap.get(memberId)!.push(task);
      }
    }

    // 7. Build member schedules with distances and conflicts
    const memberSchedules: MemberSchedule[] = [];
    const optimizationSuggestions: DailyScheduleResult["optimizationSuggestions"] =
      [];

    for (const [memberId, memberTasks] of memberTaskMap) {
      // Sort by start_time then display_order
      memberTasks.sort((a, b) => {
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
        if (a.startTime) return -1;
        if (b.startTime) return 1;
        return a.displayOrder - b.displayOrder;
      });

      // Compute distances between consecutive stops
      const tasksWithDistance = memberTasks.map((task, idx) => {
        let distanceFromPrev = 0;
        if (idx > 0) {
          const prev = memberTasks[idx - 1];
          if (
            prev.latitude != null &&
            prev.longitude != null &&
            task.latitude != null &&
            task.longitude != null
          ) {
            distanceFromPrev = Math.round(
              haversineDistance(
                prev.latitude,
                prev.longitude,
                task.latitude,
                task.longitude
              ) * 10
            ) / 10;
          }
        }
        return { ...task, distanceFromPrev };
      });

      const totalDistance = tasksWithDistance.reduce(
        (sum, t) => sum + t.distanceFromPrev,
        0
      );

      // Detect overlapping tasks (conflicts)
      const conflicts: MemberSchedule["conflicts"] = [];
      for (let i = 0; i < memberTasks.length; i++) {
        for (let j = i + 1; j < memberTasks.length; j++) {
          const a = memberTasks[i];
          const b = memberTasks[j];

          // Compare using start_time/end_time if available, otherwise start_date/end_date
          const aStart = a.startTime
            ? new Date(`${dateStr}T${a.startTime}`)
            : a.startDate
              ? new Date(a.startDate)
              : null;
          const aEnd = a.endTime
            ? new Date(`${dateStr}T${a.endTime}`)
            : a.endDate
              ? new Date(a.endDate)
              : aStart;
          const bStart = b.startTime
            ? new Date(`${dateStr}T${b.startTime}`)
            : b.startDate
              ? new Date(b.startDate)
              : null;
          const bEnd = b.endTime
            ? new Date(`${dateStr}T${b.endTime}`)
            : b.endDate
              ? new Date(b.endDate)
              : bStart;

          if (aStart && aEnd && bStart && bEnd) {
            if (aStart < bEnd && bStart < aEnd) {
              const overlapStart = aStart > bStart ? aStart : bStart;
              const overlapEnd = aEnd < bEnd ? aEnd : bEnd;
              conflicts.push({
                task1Id: a.taskId,
                task1Title: a.taskTitle,
                task2Id: b.taskId,
                task2Title: b.taskTitle,
                overlapStart: overlapStart.toISOString(),
                overlapEnd: overlapEnd.toISOString(),
              });
            }
          }
        }
      }

      memberSchedules.push({
        memberId,
        memberName: memberNameMap.get(memberId) ?? "Unknown",
        tasks: tasksWithDistance,
        totalDistance: Math.round(totalDistance * 10) / 10,
        conflicts,
      });

      // Check route optimization opportunity
      const geoTasks = memberTasks.filter(
        (t) => t.latitude != null && t.longitude != null
      );
      if (geoTasks.length >= 3) {
        const currentCoords = geoTasks.map((t) => ({
          lat: t.latitude!,
          lng: t.longitude!,
          taskId: t.taskId,
        }));
        const optimizedCoords = nearestNeighborOrder(currentCoords);

        const currentDist = computeRouteDistance(currentCoords);
        const optimizedDist = computeRouteDistance(optimizedCoords);

        // Only suggest if at least 2km saved (meaningful difference)
        if (currentDist - optimizedDist >= 2) {
          optimizationSuggestions.push({
            type: "route_reorder",
            memberId,
            memberName: memberNameMap.get(memberId) ?? "Unknown",
            details: {
              currentOrder: geoTasks.map((t) => t.taskId),
              suggestedOrder: optimizedCoords.map((c) => c.taskId),
              currentDistance: currentDist,
              suggestedDistance: optimizedDist,
              distanceSaved: Math.round((currentDist - optimizedDist) * 10) / 10,
            },
          });
        }
      }

      // Add conflict suggestions
      for (const conflict of conflicts) {
        optimizationSuggestions.push({
          type: "conflict",
          memberId,
          memberName: memberNameMap.get(memberId) ?? "Unknown",
          details: conflict,
        });
      }
    }

    // Add unassigned task suggestions
    for (const task of unassignedTasks) {
      optimizationSuggestions.push({
        type: "unassigned",
        details: {
          taskId: task.taskId,
          taskTitle: task.taskTitle,
          projectName: task.projectName,
        },
      });
    }

    return {
      date: dateStr,
      memberSchedules,
      unassignedTasks,
      optimizationSuggestions,
    };
  },

  /**
   * Analyze the daily schedule and propose optimizations via the approval queue.
   * Phase C gated. Rate limited to 15 suggestions per company per run.
   */
  async suggestScheduleOptimizations(
    companyId: string,
    userId: string,
    date: Date
  ): Promise<{ proposed: number; conflicts: number; unassigned: number }> {
    // Phase C gate
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) {
      return { proposed: 0, conflicts: 0, unassigned: 0 };
    }

    // Load settings
    const settings = await loadScheduleSettings(companyId);
    if (!settings.enabled) {
      return { proposed: 0, conflicts: 0, unassigned: 0 };
    }

    const result = await this.optimizeDailySchedule(companyId, date);
    const dateStr = formatDateStr(date);

    let proposed = 0;
    let conflictCount = 0;
    let unassignedCount = 0;
    const MAX_SUGGESTIONS = 15;

    // Helper to build task lookup for enriched data
    const allTasks = new Map<string, TaskWithProject>();
    for (const ms of result.memberSchedules) {
      for (const t of ms.tasks) {
        allTasks.set(t.taskId, t);
      }
    }
    for (const t of result.unassignedTasks) {
      allTasks.set(t.taskId, t);
    }

    // (a) Route reorder suggestions
    if (settings.travel_optimization) {
      for (const suggestion of result.optimizationSuggestions) {
        if (proposed >= MAX_SUGGESTIONS) break;
        if (suggestion.type !== "route_reorder") continue;

        const d = suggestion.details as {
          currentOrder: string[];
          suggestedOrder: string[];
          currentDistance: number;
          suggestedDistance: number;
          distanceSaved: number;
        };

        const currentOrderItems = d.currentOrder.map((id) => {
          const t = allTasks.get(id);
          return {
            task_id: id,
            task_title: t?.taskTitle ?? "Unknown",
            project_name: t?.projectName ?? "Unknown",
            address: t?.address ?? null,
          };
        });
        const suggestedOrderItems = d.suggestedOrder.map((id) => {
          const t = allTasks.get(id);
          return {
            task_id: id,
            task_title: t?.taskTitle ?? "Unknown",
            project_name: t?.projectName ?? "Unknown",
            address: t?.address ?? null,
          };
        });

        const actionData: OptimizeScheduleActionData = {
          optimization_type: "route_reorder",
          team_member_id: suggestion.memberId!,
          team_member_name: suggestion.memberName!,
          date: dateStr,
          current_order: currentOrderItems,
          suggested_order: suggestedOrderItems,
          current_distance_km: d.currentDistance,
          suggested_distance_km: d.suggestedDistance,
          distance_saved_km: d.distanceSaved,
        };

        try {
          const actionId = await ApprovalQueueService.proposeAction({
            companyId,
            userId,
            actionType: "optimize_schedule",
            actionData: actionData as unknown as Record<string, unknown>,
            contextSummary: buildContextSummary({
              type: "route_reorder",
              params: {
                memberName: suggestion.memberName!,
                date: dateStr,
                distanceSaved: d.distanceSaved,
              },
            }),
            contextSource: "schedule_optimization",
            sourceId: `schedule:${suggestion.memberId}:${dateStr}`,
            confidence: 0.7,
            priority: "normal",
          });
          if (actionId) proposed++;
        } catch (err) {
          console.error(
            "[schedule-optimization] route reorder propose failed:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    // (b) Conflict resolution suggestions
    if (settings.conflict_detection) {
      for (const schedule of result.memberSchedules) {
        for (const conflict of schedule.conflicts) {
          if (proposed >= MAX_SUGGESTIONS) break;

          const task2 = allTasks.get(conflict.task2Id);
          const task2Duration = task2?.duration ?? 1;

          // Use findScheduleGap to find a day that actually has capacity
          // for this team member — avoids blindly pushing into another conflict.
          let newStartISO: string;
          let newEndISO: string | null = null;
          try {
            const afterDate = new Date(date);
            afterDate.setDate(afterDate.getDate() + 1);
            afterDate.setHours(0, 0, 0, 0);
            const gap = await AssignmentService.findScheduleGap(
              companyId,
              schedule.memberId,
              task2Duration,
              afterDate
            );
            newStartISO = gap.startDate.toISOString();
            newEndISO = gap.endDate.toISOString();
          } catch (err) {
            console.error(
              "[schedule-optimization] findScheduleGap fallback:",
              err instanceof Error ? err.message : err
            );
            const fallback = new Date(date);
            fallback.setDate(fallback.getDate() + 1);
            newStartISO = fallback.toISOString();
          }

          const actionData: RescheduleTasksActionData = {
            resolution_type: "conflict",
            conflicting_task_ids: [conflict.task1Id, conflict.task2Id],
            conflict_details: [
              {
                task_id: conflict.task1Id,
                task_title: conflict.task1Title,
                project_name:
                  allTasks.get(conflict.task1Id)?.projectName ?? "Unknown",
                start_date:
                  allTasks.get(conflict.task1Id)?.startDate ?? dateStr,
                end_date: allTasks.get(conflict.task1Id)?.endDate ?? dateStr,
              },
              {
                task_id: conflict.task2Id,
                task_title: conflict.task2Title,
                project_name: task2?.projectName ?? "Unknown",
                start_date: task2?.startDate ?? dateStr,
                end_date: task2?.endDate ?? dateStr,
              },
            ],
            suggested_resolution: {
              task_id: conflict.task2Id,
              task_title: conflict.task2Title,
              new_start_date: newStartISO,
              new_end_date: newEndISO,
              new_team_member_id: null,
              new_team_member_name: null,
              reason: {
                type: "conflict_with",
                params: { taskTitle: conflict.task1Title },
              },
            },
            team_member_id: schedule.memberId,
            team_member_name: schedule.memberName,
            date: dateStr,
          };

          try {
            const actionId = await ApprovalQueueService.proposeAction({
              companyId,
              userId,
              actionType: "reschedule_tasks",
              actionData: actionData as unknown as Record<string, unknown>,
              contextSummary: buildContextSummary({
                type: "schedule_conflict",
                params: {
                  memberName: schedule.memberName,
                  task1: conflict.task1Title,
                  task2: conflict.task2Title,
                  date: dateStr,
                },
              }),
              contextSource: "schedule_optimization",
              sourceId: `conflict:${conflict.task1Id}:${conflict.task2Id}`,
              confidence: 0.6,
              priority: "high",
            });
            if (actionId) {
              proposed++;
              conflictCount++;
            }
          } catch (err) {
            console.error(
              "[schedule-optimization] conflict propose failed:",
              err instanceof Error ? err.message : err
            );
          }
        }
      }
    }

    // (c) Unassigned task suggestions
    for (const task of result.unassignedTasks) {
      if (proposed >= MAX_SUGGESTIONS) break;

      // Use AssignmentService to find best candidate
      let suggestedMemberId: string | null = null;
      let suggestedMemberName: string | null = null;
      let assignmentReason = "";

      if (task.taskTypeId) {
        const candidates = await AssignmentService.suggestAssignment(
          companyId,
          task.taskTypeId,
          task.projectId
        );
        if (candidates.length > 0) {
          suggestedMemberId = candidates[0].userId;
          suggestedMemberName = candidates[0].name;
          assignmentReason = candidates[0].reason;
        }
      }

      const actionData: RescheduleTasksActionData = {
        resolution_type: "assign",
        task_id: task.taskId,
        task_title: task.taskTitle,
        project_name: task.projectName,
        suggested_team_member_id: suggestedMemberId ?? undefined,
        suggested_team_member_name: suggestedMemberName ?? undefined,
        assignment_reason: assignmentReason || undefined,
      };

      // Check for weather risk — ONLY for tasks whose type is configured
      // as outdoor/weather-sensitive in company settings.
      const isOutdoorTask =
        task.taskTypeId != null &&
        settings.outdoor_task_type_ids.includes(task.taskTypeId);

      if (
        settings.weather_awareness &&
        isOutdoorTask &&
        task.latitude != null &&
        task.longitude != null
      ) {
        try {
          const weather = await this.getWeatherAwareness(
            companyId,
            date,
            task.latitude,
            task.longitude,
            settings
          );
          if (weather.weatherRisk) {
            actionData.weather_risk = {
              risk_level: weather.riskLevel,
              reason: weather.reason,
            };
          }
        } catch (err) {
          console.error(
            "[schedule-optimization] weather check failed:",
            err instanceof Error ? err.message : err
          );
        }
      }

      try {
        const actionId = await ApprovalQueueService.proposeAction({
          companyId,
          userId,
          actionType: "reschedule_tasks",
          actionData: actionData as unknown as Record<string, unknown>,
          contextSummary: buildContextSummary({
            type: "unassigned_task",
            params: {
              taskTitle: task.taskTitle,
              suggestedMember: suggestedMemberName ?? "",
            },
          }),
          contextSource: "schedule_optimization",
          sourceId: `unassigned:${task.taskId}`,
          confidence: 0.6,
          priority: "normal",
        });
        if (actionId) {
          proposed++;
          unassignedCount++;
        }
      } catch (err) {
        console.error(
          "[schedule-optimization] unassigned propose failed:",
          err instanceof Error ? err.message : err
        );
      }
    }

    return { proposed, conflicts: conflictCount, unassigned: unassignedCount };
  },

  /**
   * Detect downstream impacts when a task is rescheduled, cancelled, or reassigned.
   * Proposes rescheduling actions for affected tasks via the queue.
   *
   * Two cascade checks:
   *   1. Same-day overlaps for the same team member
   *   2. Same-project downstream tasks that begin within 24h of the changed task's end
   *
   * Both checks always emit suggested_resolution so the executor has a valid payload.
   * Deleted tasks are skipped. All supabase calls are error-safe.
   */
  async handleRescheduleCascade(
    companyId: string,
    userId: string,
    taskId: string,
    changeType: string
  ): Promise<{ cascadeProposed: number }> {
    try {
      // Phase C gate (skipped for internal calls that already gated)
      const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
        companyId,
        "phase_c"
      );
      if (!enabled) return { cascadeProposed: 0 };

      const settings = await loadScheduleSettings(companyId);
      if (!settings.cascade_detection) return { cascadeProposed: 0 };

      const supabase = requireSupabase();

      // Fetch the changed task (must not be soft-deleted)
      const { data: changedTask, error: changedErr } = await supabase
        .from("project_tasks")
        .select(
          "id, custom_title, project_id, start_date, end_date, team_member_ids, status, start_time, end_time"
        )
        .eq("id", taskId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .single();

      if (changedErr || !changedTask) {
        if (changedErr && changedErr.code !== "PGRST116") {
          console.error("[schedule-optimization] cascade fetch changed task:", changedErr.message);
        }
        return { cascadeProposed: 0 };
      }

      const changedTitle = (changedTask.custom_title as string) ?? "Untitled";
      const changedProjectId = changedTask.project_id as string;
      const changedDate = changedTask.start_date as string | null;
      const changedTeamIds = parseStringArray(changedTask.team_member_ids);

      let cascadeProposed = 0;

      // Collect all affected task IDs up-front so we can batch project title fetch
      interface CandidateCascade {
        affectedTaskId: string;
        affectedTitle: string;
        affectedProjectId: string;
        currentStart: string | null;
        currentEnd: string | null;
        proposedStart: string | null;
        proposedEnd: string | null;
        checkType: "same_day_overlap" | "downstream_dependency";
      }

      const candidates: CandidateCascade[] = [];

      // Check 1: Same team member has overlapping tasks same day
      if (changedDate && changedTeamIds.length > 0) {
        const dayStr = new Date(changedDate).toISOString().split("T")[0];
        const dayStart = `${dayStr}T00:00:00.000Z`;
        const dayEnd = `${dayStr}T23:59:59.999Z`;

        const { data: sameDayTasks, error: sameDayErr } = await supabase
          .from("project_tasks")
          .select(
            "id, custom_title, project_id, start_date, end_date, team_member_ids, start_time, end_time"
          )
          .eq("company_id", companyId)
          .eq("status", "active")
          .is("deleted_at", null)
          .not("start_date", "is", null)
          .gte("start_date", dayStart)
          .lte("start_date", dayEnd)
          .neq("id", taskId)
          .limit(100);

        if (sameDayErr) {
          console.error("[schedule-optimization] cascade same-day fetch:", sameDayErr.message);
        }

        for (const otherTask of sameDayTasks ?? []) {
          const otherTeamIds = parseStringArray(otherTask.team_member_ids);
          const sharedMembers = changedTeamIds.filter((id) =>
            otherTeamIds.includes(id)
          );
          if (sharedMembers.length === 0) continue;

          const changedStart = changedTask.start_time
            ? new Date(`${dayStr}T${changedTask.start_time}`)
            : new Date(changedDate);
          const changedEnd = changedTask.end_time
            ? new Date(`${dayStr}T${changedTask.end_time}`)
            : changedTask.end_date
              ? new Date(changedTask.end_date as string)
              : changedStart;
          const otherStart = otherTask.start_time
            ? new Date(`${dayStr}T${otherTask.start_time as string}`)
            : otherTask.start_date
              ? new Date(otherTask.start_date as string)
              : null;
          const otherEnd = otherTask.end_time
            ? new Date(`${dayStr}T${otherTask.end_time as string}`)
            : otherTask.end_date
              ? new Date(otherTask.end_date as string)
              : otherStart;

          if (
            otherStart &&
            otherEnd &&
            changedStart < otherEnd &&
            otherStart < changedEnd
          ) {
            // Propose pushing the other task to the next calendar day at the same time
            const proposedStartDate = new Date(otherStart);
            proposedStartDate.setDate(proposedStartDate.getDate() + 1);
            const proposedEndDate = new Date(otherEnd);
            proposedEndDate.setDate(proposedEndDate.getDate() + 1);

            candidates.push({
              affectedTaskId: otherTask.id as string,
              affectedTitle: (otherTask.custom_title as string) ?? "Untitled",
              affectedProjectId: otherTask.project_id as string,
              currentStart: (otherTask.start_date as string) ?? null,
              currentEnd: (otherTask.end_date as string) ?? null,
              proposedStart: proposedStartDate.toISOString(),
              proposedEnd: proposedEndDate.toISOString(),
              checkType: "same_day_overlap",
            });
          }
        }
      }

      // Check 2: Same project has dependent tasks
      if (changedProjectId) {
        const { data: projectTasks, error: projTasksErr } = await supabase
          .from("project_tasks")
          .select(
            "id, custom_title, project_id, start_date, end_date, team_member_ids, display_order"
          )
          .eq("company_id", companyId)
          .eq("project_id", changedProjectId)
          .eq("status", "active")
          .is("deleted_at", null)
          .neq("id", taskId)
          .not("start_date", "is", null)
          .order("display_order", { ascending: true })
          .limit(50);

        if (projTasksErr) {
          console.error("[schedule-optimization] cascade project tasks:", projTasksErr.message);
        }

        const changedEndDate = changedTask.end_date
          ? new Date(changedTask.end_date as string)
          : changedDate
            ? new Date(changedDate)
            : null;

        if (changedEndDate) {
          for (const depTask of projectTasks ?? []) {
            const depStart = depTask.start_date
              ? new Date(depTask.start_date as string)
              : null;
            if (!depStart) continue;

            // Dependent if it starts within 24h before/after the changed task's end
            if (
              depStart <= changedEndDate &&
              depStart >=
                new Date(changedEndDate.getTime() - 24 * 60 * 60 * 1000)
            ) {
              // Propose pushing the dependent task to start 1 day after the changed task ends
              const proposedStart = new Date(changedEndDate);
              proposedStart.setDate(proposedStart.getDate() + 1);
              const depEnd = depTask.end_date
                ? new Date(depTask.end_date as string)
                : depStart;
              const durationMs = Math.max(
                24 * 60 * 60 * 1000,
                depEnd.getTime() - depStart.getTime()
              );
              const proposedEnd = new Date(proposedStart.getTime() + durationMs);

              candidates.push({
                affectedTaskId: depTask.id as string,
                affectedTitle: (depTask.custom_title as string) ?? "Untitled",
                affectedProjectId: changedProjectId,
                currentStart: (depTask.start_date as string) ?? null,
                currentEnd: (depTask.end_date as string) ?? null,
                proposedStart: proposedStart.toISOString(),
                proposedEnd: proposedEnd.toISOString(),
                checkType: "downstream_dependency",
              });
            }
          }
        }
      }

      if (candidates.length === 0) return { cascadeProposed: 0 };

      // Batch fetch project titles for all candidates in a single query
      const projectIds = [...new Set(candidates.map((c) => c.affectedProjectId))];
      const projectTitleMap = new Map<string, string>();
      if (projectIds.length > 0) {
        const { data: projects, error: projErr } = await supabase
          .from("projects")
          .select("id, title")
          .eq("company_id", companyId)
          .in("id", projectIds)
          .is("deleted_at", null);
        if (projErr) {
          console.error("[schedule-optimization] cascade project fetch:", projErr.message);
        }
        for (const p of projects ?? []) {
          projectTitleMap.set(p.id as string, (p.title as string) ?? "Unknown");
        }
      }

      // Emit proposal for each candidate — ALWAYS includes suggested_resolution
      for (const c of candidates) {
        const projectName = projectTitleMap.get(c.affectedProjectId) ?? "Unknown";

        const actionData: RescheduleTasksActionData = {
          resolution_type: "cascade",
          cascade_source_task_id: taskId,
          cascade_source_task_title: changedTitle,
          cascade_change_type: changeType,
          affected_tasks: [
            {
              task_id: c.affectedTaskId,
              task_title: c.affectedTitle,
              project_name: projectName,
              current_start_date: c.currentStart,
              current_end_date: c.currentEnd,
              proposed_start_date: c.proposedStart,
              proposed_end_date: c.proposedEnd,
            },
          ],
          suggested_resolution: {
            task_id: c.affectedTaskId,
            task_title: c.affectedTitle,
            new_start_date: c.proposedStart,
            new_end_date: c.proposedEnd,
            new_team_member_id: null,
            new_team_member_name: null,
            reason: {
              type: c.checkType === "same_day_overlap"
                ? "cascade_same_day_overlap"
                : "cascade_downstream_dependency",
              params: { sourceTask: changedTitle, changeType },
            },
          },
        };

        try {
          const actionId = await ApprovalQueueService.proposeAction({
            companyId,
            userId,
            actionType: "reschedule_tasks",
            actionData: actionData as unknown as Record<string, unknown>,
            contextSummary: buildContextSummary({
              type: "cascade_impact",
              params: {
                sourceTask: changedTitle,
                affectedTask: c.affectedTitle,
              },
            }),
            contextSource: "schedule_optimization",
            sourceId: `cascade:${taskId}:${c.affectedTaskId}`,
            confidence: 0.5,
            priority: "normal",
          });
          if (actionId) cascadeProposed++;
        } catch (err) {
          console.error(
            "[schedule-optimization] cascade propose action:",
            err instanceof Error ? err.message : err
          );
        }
      }

      return { cascadeProposed };
    } catch (err) {
      console.error(
        "[schedule-optimization] handleRescheduleCascade failed:",
        err instanceof Error ? err.message : err
      );
      return { cascadeProposed: 0 };
    }
  },

  /**
   * Check weather awareness for a specific location and date.
   * MVP: seasonal heuristic based on climate zone. Designed so a real
   * weather API can be swapped in later by changing only this method.
   */
  async getWeatherAwareness(
    companyId: string,
    date: Date,
    latitude: number,
    longitude: number,
    settingsOverride?: ScheduleOptimizationSettings
  ): Promise<WeatherAwareness> {
    const settings = settingsOverride ?? (await loadScheduleSettings(companyId));

    if (!settings.weather_awareness) {
      return {
        weatherRisk: false,
        riskLevel: "low",
        reason: { type: "disabled", params: {} },
      };
    }

    const month = date.getMonth(); // 0-indexed

    // Determine hemisphere
    let isNorthern = true;
    if (settings.climate_zone === "southern") {
      isNorthern = false;
    } else if (settings.climate_zone === "auto") {
      isNorthern = latitude >= 0;
    }

    // Winter months: Nov-Mar for northern, May-Sep for southern
    const winterMonths = isNorthern
      ? [10, 11, 0, 1, 2] // Nov, Dec, Jan, Feb, Mar
      : [4, 5, 6, 7, 8]; // May, Jun, Jul, Aug, Sep

    const isWinter = winterMonths.includes(month);

    if (!isWinter) {
      return {
        weatherRisk: false,
        riskLevel: "low",
        reason: { type: "no_seasonal_risk", params: {} },
      };
    }

    // Determine risk level by month depth into winter
    const peakWinter = isNorthern ? [11, 0, 1] : [5, 6, 7]; // Dec/Jan/Feb or Jun/Jul/Aug
    const isPeakWinter = peakWinter.includes(month);

    return {
      weatherRisk: true,
      riskLevel: isPeakWinter ? "high" : "medium",
      reason: {
        type: "winter_risk",
        params: {
          month: date.toLocaleString("en-US", { month: "long" }),
          hemisphere: isNorthern ? "northern" : "southern",
        },
      },
    };
  },

  /**
   * Get a quick health summary for today's schedule (used by dashboard widget).
   * Does NOT propose actions — read-only analysis.
   *
   * Respects settings.enabled: returns a disabled payload when schedule
   * optimization is turned off, avoiding unnecessary DB work.
   */
  async getScheduleHealth(
    companyId: string,
    date: Date
  ): Promise<{
    totalMembers: number;
    activeMembers: number;
    conflictCount: number;
    unassignedCount: number;
    weatherRiskCount: number;
    pendingSuggestions: number;
    enabled: boolean;
  }> {
    try {
      const settings = await loadScheduleSettings(companyId);
      if (!settings.enabled) {
        return {
          totalMembers: 0,
          activeMembers: 0,
          conflictCount: 0,
          unassignedCount: 0,
          weatherRiskCount: 0,
          pendingSuggestions: 0,
          enabled: false,
        };
      }

      const supabase = requireSupabase();
      const result = await this.optimizeDailySchedule(companyId, date);

      // Count total active members
      const { count: totalMembers, error: usersErr } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("is_active", true)
        .is("deleted_at", null);

      if (usersErr) {
        console.error(
          "[schedule-optimization] getScheduleHealth users count:",
          usersErr.message
        );
      }

      const activeMembers = result.memberSchedules.length;
      const conflictCount = result.memberSchedules.reduce(
        (sum, ms) => sum + ms.conflicts.length,
        0
      );
      const unassignedCount = result.unassignedTasks.length;

      // Weather risk: check outdoor tasks
      let weatherRiskCount = 0;

      if (
        settings.weather_awareness &&
        settings.outdoor_task_type_ids.length > 0
      ) {
        const allTasks = result.memberSchedules.flatMap((ms) => ms.tasks);
        const outdoorTasks = allTasks.filter(
          (t) =>
            t.taskTypeId &&
            settings.outdoor_task_type_ids.includes(t.taskTypeId)
        );

        if (outdoorTasks.length > 0) {
          const firstWithCoords = outdoorTasks.find(
            (t) => t.latitude != null && t.longitude != null
          );
          if (firstWithCoords) {
            try {
              const weather = await this.getWeatherAwareness(
                companyId,
                date,
                firstWithCoords.latitude!,
                firstWithCoords.longitude!,
                settings
              );
              if (weather.weatherRisk) {
                weatherRiskCount = outdoorTasks.length;
              }
            } catch (err) {
              console.error(
                "[schedule-optimization] getScheduleHealth weather:",
                err instanceof Error ? err.message : err
              );
            }
          }
        }
      }

      // Count pending schedule-related suggestions
      const { count: pendingSuggestions, error: pendingErr } = await supabase
        .from("agent_actions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("action_type", ["optimize_schedule", "reschedule_tasks"])
        .eq("status", "pending");

      if (pendingErr) {
        console.error(
          "[schedule-optimization] getScheduleHealth pending count:",
          pendingErr.message
        );
      }

      return {
        totalMembers: totalMembers ?? 0,
        activeMembers,
        conflictCount,
        unassignedCount,
        weatherRiskCount,
        pendingSuggestions: pendingSuggestions ?? 0,
        enabled: true,
      };
    } catch (err) {
      console.error(
        "[schedule-optimization] getScheduleHealth failed:",
        err instanceof Error ? err.message : err
      );
      return {
        totalMembers: 0,
        activeMembers: 0,
        conflictCount: 0,
        unassignedCount: 0,
        weatherRiskCount: 0,
        pendingSuggestions: 0,
        enabled: false,
      };
    }
  },
};
