"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isSameDay, startOfWeek, endOfWeek, isBefore, isAfter } from "date-fns";
import {
  type InternalScheduleEvent,
} from "@/lib/utils/schedule-utils";
import { useScheduleStore } from "@/stores/schedule-store";
import { useTasks, useTeamMembers } from "@/lib/hooks";
import { TaskStatus } from "@/lib/types/models";
import { ChevronDown, X } from "lucide-react";

interface ScheduleToolbarProps {
  events: InternalScheduleEvent[];
  t: (key: string) => string;
}

export function ScheduleToolbar({ events, t }: ScheduleToolbarProps) {
  const {
    filterTeamMemberIds,
    filterTaskTypes,
    filterProjectIds,
    filterStatuses,
    updateFilters,
    unscheduledTrayCollapsed,
    toggleUnscheduledTray,
    setHighlightedTaskType,
    setHighlightedTeamMemberId,
  } = useScheduleStore();

  // Legend dropdown — collapsed by default. Click summary chip to expand.
  const [legendOpen, setLegendOpen] = useState(false);
  const legendWrapRef = useRef<HTMLDivElement | null>(null);

  // Team-member dropdown — same interaction pattern as legend.
  const [teamOpen, setTeamOpen] = useState(false);
  const teamWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!legendOpen) {
      setHighlightedTaskType(null);
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (
        legendWrapRef.current &&
        !legendWrapRef.current.contains(e.target as Node)
      ) {
        setLegendOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [legendOpen, setHighlightedTaskType]);

  useEffect(() => {
    if (!teamOpen) {
      setHighlightedTeamMemberId(null);
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (
        teamWrapRef.current &&
        !teamWrapRef.current.contains(e.target as Node)
      ) {
        setTeamOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [teamOpen, setHighlightedTeamMemberId]);

  // Unscheduled count for the toolbar chip (T15)
  const { data: taskData } = useTasks();
  const { data: teamData } = useTeamMembers();
  const teamMembers = useMemo(() => teamData?.users ?? [], [teamData]);

  // Per-member event counts (use crewIds from each event so it tracks
  // multi-assignee tasks; unassigned events naturally fall out).
  const memberEventCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      for (const id of e.crewIds) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  }, [events]);

  // Helper — toggle a member id in the persisted filter list.
  function toggleMemberFilter(id: string) {
    const current = filterTeamMemberIds;
    updateFilters({
      filterTeamMemberIds: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  }

  // Helper — toggle a task type in the persisted filter list. Mirrors
  // FilterSidebar.toggleTaskType so legend click and sidebar checkbox
  // are kept in sync.
  function toggleTypeFilter(typeLabel: string) {
    const current = filterTaskTypes;
    updateFilters({
      filterTaskTypes: current.includes(typeLabel)
        ? current.filter((x) => x !== typeLabel)
        : [...current, typeLabel],
    });
  }
  const unscheduledCount = useMemo(() => {
    const all = taskData?.tasks ?? [];
    return all.filter(
      (t) =>
        !t.startDate &&
        t.status !== TaskStatus.Completed &&
        t.status !== TaskStatus.Cancelled &&
        !t.deletedAt
    ).length;
  }, [taskData]);

  const stats = useMemo(() => {
    const today = new Date();
    const todayEvents = events.filter((e) => isSameDay(e.startDate, today));
    const weekStartDate = startOfWeek(today);
    const weekEndDate = endOfWeek(today);
    const weekEvents = events.filter(
      (e) => !isBefore(e.startDate, weekStartDate) && !isAfter(e.startDate, weekEndDate)
    );

    // Group by real type display ('Vinyl Install', 'Rail Install', etc.) and
    // remember the first effective color we see for each so the legend dot
    // matches the actual card stripe. Also track the underlying taskType key
    // (e.g. 'installation') so legend clicks can toggle the persisted
    // filterTaskTypes — which filters on key, not display label.
    const typeStats: Record<
      string,
      { count: number; color: string; key: string }
    > = {};
    events.forEach((e) => {
      const label = e.typeLabel || "Task";
      if (!typeStats[label]) {
        typeStats[label] = { count: 0, color: e.color, key: e.taskType };
      }
      typeStats[label].count += 1;
    });

    return {
      todayCount: todayEvents.length,
      weekCount: weekEvents.length,
      totalCount: events.length,
      typeStats,
    };
  }, [events]);

  // Collect active filter chips
  const activeFilters: { label: string; onRemove: () => void }[] = [];
  if (filterTeamMemberIds.length > 0) {
    activeFilters.push({
      label: `${filterTeamMemberIds.length} team member${filterTeamMemberIds.length > 1 ? "s" : ""}`,
      onRemove: () => updateFilters({ filterTeamMemberIds: [] }),
    });
  }
  if (filterTaskTypes.length > 0) {
    activeFilters.push({
      label: `${filterTaskTypes.length} type${filterTaskTypes.length > 1 ? "s" : ""}`,
      onRemove: () => updateFilters({ filterTaskTypes: [] }),
    });
  }
  if (filterProjectIds.length > 0) {
    activeFilters.push({
      label: `${filterProjectIds.length} project${filterProjectIds.length > 1 ? "s" : ""}`,
      onRemove: () => updateFilters({ filterProjectIds: [] }),
    });
  }
  if (filterStatuses.length > 0) {
    activeFilters.push({
      label: `${filterStatuses.length} status${filterStatuses.length > 1 ? "es" : ""}`,
      onRemove: () => updateFilters({ filterStatuses: [] }),
    });
  }

  return (
    <div className="flex max-w-full min-w-0 items-center gap-3 overflow-x-auto overflow-y-visible px-1 pb-1 shrink-0 scrollbar-hide">
      {/* T15 — // UNSCHEDULED [N] chip toggles the tray */}
      <button
        type="button"
        onClick={toggleUnscheduledTray}
        aria-label={
          unscheduledTrayCollapsed
            ? `Show ${unscheduledCount} unscheduled tasks`
            : "Collapse unscheduled tray"
        }
        className="font-mono text-[11px] uppercase tracking-[0.16em] tabular-nums px-2 py-1 cursor-pointer"
        style={{
          color: unscheduledCount > 0 ? "var(--text-2)" : "var(--text-3)",
          background: "var(--surface-input)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          fontFeatureSettings: '"tnum" 1, "zero" 1',
          transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            "rgba(255, 255, 255, 0.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            "var(--surface-input)";
        }}
      >
        {`// UNSCHEDULED [${unscheduledCount}]`}
      </button>
      <div className="w-[1px] h-[16px] bg-border-subtle" />

      {/* Today / This Week counts */}
      <div className="flex items-center gap-[6px]">
        <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">
          {t("stats.today")}
        </span>
        <span className="font-mono text-data-sm text-text">
          {stats.todayCount}
        </span>
      </div>
      <div className="w-[1px] h-[16px] bg-border-subtle" />
      <div className="flex items-center gap-[6px]">
        <span className="font-mono text-micro text-text-mute uppercase tracking-[0.16em]">
          {t("stats.thisWeek")}
        </span>
        <span className="font-mono text-data-sm text-text">
          {stats.weekCount}
        </span>
      </div>
      <div className="w-[1px] h-[16px] bg-border-subtle" />

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-[6px]">
          {activeFilters.map((filter) => (
            <button
              key={filter.label}
              onClick={filter.onRemove}
              className="flex items-center gap-[4px] px-[8px] py-[2px] rounded-chip bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.18)] text-text font-mono text-micro uppercase tracking-[0.16em] hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              {filter.label}
              <X className="w-[10px] h-[10px]" />
            </button>
          ))}
          <div className="w-[1px] h-[16px] bg-border-subtle" />
        </div>
      )}

      {/* Team-member dropdown — same interaction pattern as legend.
          Hover row → dim every non-matching card. Click row → toggle
          the persisted team-member filter. */}
      <div ref={teamWrapRef} className="hidden md:block ml-auto relative">
        <button
          type="button"
          onClick={() => setTeamOpen((v) => !v)}
          aria-expanded={teamOpen}
          aria-haspopup="true"
          className="flex items-center gap-[6px] px-2 py-1 cursor-pointer font-mono text-[11px] uppercase tracking-[0.16em] tabular-nums"
          style={{
            color: teamOpen ? "var(--text)" : "var(--text-2)",
            background: teamOpen
              ? "rgba(255, 255, 255, 0.08)"
              : "var(--surface-input)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            fontFeatureSettings: '"tnum" 1, "zero" 1',
            transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "rgba(255, 255, 255, 0.08)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = teamOpen
              ? "rgba(255, 255, 255, 0.08)"
              : "var(--surface-input)";
          }}
        >
          <span style={{ color: "var(--text-mute)" }}>{"// TEAM"}</span>
          <span>{`[${teamMembers.length}]`}</span>
          {filterTeamMemberIds.length > 0 && (
            <span style={{ color: "var(--text-2)" }}>
              {`(${filterTeamMemberIds.length})`}
            </span>
          )}
          <ChevronDown
            className="w-[10px] h-[10px]"
            style={{
              transform: teamOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        </button>

        {teamOpen && (
          <div
            className="absolute right-0 mt-1 z-50"
            onMouseLeave={() => setHighlightedTeamMemberId(null)}
            style={{
              minWidth: 240,
              background: "rgba(18, 18, 20, 0.78)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255, 255, 255, 0.09)",
              borderRadius: 12,
              padding: "6px 0",
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {teamMembers.length === 0 ? (
              <div
                className="px-3 py-[6px] font-mono text-[11px] uppercase tracking-[0.16em]"
                style={{ color: "var(--text-mute)" }}
              >
                {"// NO TEAM MEMBERS"}
              </div>
            ) : (
              teamMembers
                .slice()
                .sort((a, b) => {
                  const an = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.email || "";
                  const bn = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || b.email || "";
                  return an.localeCompare(bn);
                })
                .map((member) => {
                  const name =
                    `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() ||
                    member.email ||
                    "Unknown";
                  const count = memberEventCounts[member.id] ?? 0;
                  const isFiltered = filterTeamMemberIds.includes(member.id);
                  return (
                    <div
                      key={member.id}
                      onMouseEnter={() => setHighlightedTeamMemberId(member.id)}
                      onClick={() => toggleMemberFilter(member.id)}
                      className="flex items-center gap-[8px] px-3 py-[5px] cursor-pointer"
                      style={{
                        background: isFiltered
                          ? "rgba(255, 255, 255, 0.06)"
                          : "transparent",
                        transition:
                          "background 0.12s cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                      onMouseOver={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          isFiltered
                            ? "rgba(255, 255, 255, 0.10)"
                            : "rgba(255, 255, 255, 0.05)";
                      }}
                      onMouseOut={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          isFiltered
                            ? "rgba(255, 255, 255, 0.06)"
                            : "transparent";
                      }}
                    >
                      {member.profileImageURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={member.profileImageURL}
                          alt=""
                          className="w-[18px] h-[18px] rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-[18px] h-[18px] rounded-full bg-fill-neutral-dim shrink-0 flex items-center justify-center">
                          <span className="font-mono text-[11px] text-text-mute uppercase leading-none">
                            {name.charAt(0)}
                          </span>
                        </div>
                      )}
                      <span
                        className="font-mono text-[11px] uppercase tracking-[0.16em] flex-1 truncate"
                        style={{
                          color: isFiltered ? "var(--text)" : "var(--text-2)",
                        }}
                      >
                        {name}
                      </span>
                      <span
                        className="font-mono text-[11px] tabular-nums"
                        style={{
                          color: "var(--text-3)",
                          fontFeatureSettings: '"tnum" 1, "zero" 1',
                        }}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })
            )}
          </div>
        )}
      </div>

      {/* Task type legend — collapsed dropdown. Click the summary chip to
          open the panel. Hovering a row dims every non-matching event card
          across the calendar (highlightedTaskType state). Clicking a row
          toggles the persisted filterTaskTypes filter. */}
      <div ref={legendWrapRef} className="hidden md:block relative">
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
          aria-haspopup="true"
          className="flex items-center gap-[6px] px-2 py-1 cursor-pointer font-mono text-[11px] uppercase tracking-[0.16em] tabular-nums"
          style={{
            color: legendOpen ? "var(--text)" : "var(--text-2)",
            background: legendOpen
              ? "rgba(255, 255, 255, 0.08)"
              : "var(--surface-input)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            fontFeatureSettings: '"tnum" 1, "zero" 1',
            transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "rgba(255, 255, 255, 0.08)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = legendOpen
              ? "rgba(255, 255, 255, 0.08)"
              : "var(--surface-input)";
          }}
        >
          <span style={{ color: "var(--text-mute)" }}>{"// LEGEND"}</span>
          <span>{`[${Object.keys(stats.typeStats).length}]`}</span>
          <ChevronDown
            className="w-[10px] h-[10px]"
            style={{
              transform: legendOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        </button>

        {legendOpen && (
          <div
            className="absolute right-0 mt-1 z-50"
            onMouseLeave={() => setHighlightedTaskType(null)}
            style={{
              minWidth: 220,
              background: "rgba(18, 18, 20, 0.78)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255, 255, 255, 0.09)",
              borderRadius: 12,
              padding: "6px 0",
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {Object.entries(stats.typeStats)
              .sort(([, a], [, b]) => b.count - a.count)
              .map(([type, { count, color, key }]) => {
                const isFiltered = filterTaskTypes.includes(key);
                return (
                  <div
                    key={type}
                    onMouseEnter={() => setHighlightedTaskType(type)}
                    onClick={() => toggleTypeFilter(key)}
                    className="flex items-center gap-[8px] px-3 py-[5px] cursor-pointer"
                    role="button"
                    style={{
                      background: isFiltered
                        ? "rgba(255, 255, 255, 0.06)"
                        : "transparent",
                      transition:
                        "background 0.12s cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                    onMouseOver={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        isFiltered
                          ? "rgba(255, 255, 255, 0.10)"
                          : "rgba(255, 255, 255, 0.05)";
                    }}
                    onMouseOut={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        isFiltered
                          ? "rgba(255, 255, 255, 0.06)"
                          : "transparent";
                    }}
                  >
                    <div
                      className="w-[8px] h-[8px] rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className="font-mono text-[11px] uppercase tracking-[0.16em] flex-1 truncate"
                      style={{
                        color: isFiltered ? "var(--text)" : "var(--text-2)",
                      }}
                    >
                      {type}
                    </span>
                    <span className="font-mono text-[11px] text-text-3 tabular-nums">
                      {count}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
