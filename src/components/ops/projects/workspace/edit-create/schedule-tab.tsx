"use client";

import * as React from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Field } from "@/components/ops/projects/workspace/atoms/field";
import { FieldRow } from "@/components/ops/projects/workspace/atoms/field-row";
import { TextInput } from "@/components/ops/projects/workspace/atoms/text-input";
import { Segmented } from "@/components/ops/projects/workspace/atoms/segmented";
import { Select } from "@/components/ops/projects/workspace/atoms/select";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { useDictionary } from "@/i18n/client";
import { useProjectTeam } from "@/lib/hooks/use-project-team";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import type {
  EditCreateMode,
  ProjectEditCreateFormValues,
} from "./project-edit-create-body";

// `ScheduleTab` — workspace edit/create schedule surface.
//
// Reads the shared form context and registers these fields:
//   status     → projects.status        (lifecycle picker — editor-only,
//                  excludes Archived which uses the footer archive button)
//   startDate  → projects.start_date    (yyyy-mm-dd ISO)
//   endDate    → projects.end_date      (yyyy-mm-dd ISO)
//   duration   → derived from start/end (in days), manually overrideable
//   visibility → projects.visibility    (Segmented: all/office/private)
//
// Date inputs render in JetBrains Mono (workspace tabular voice). Once
// both Start and End land, Duration is automatically populated; manually
// editing Duration replaces the derived value (the operator's number wins
// — schedule reality is messier than calendar math).
//
// Status changes are persisted by ProjectEditCreateBody.handleSubmit via
// useUpdateProjectStatus, not via the generic project patch — that hook
// owns the lifecycle plumbing (status_change activity row + crew
// notifications). The status field only writes the form value; submission
// dispatches the lifecycle hook when it changes.
//
// Visibility maps 1:1 to the iOS-mirrored enum on `projects.visibility`.
//
// TEAM rail (editing only): a non-editable summary of the project's
// current team plus a hint that team assignments are managed at the
// task level. Projects.team_member_ids is a server-derived column
// (recomputed from project_tasks.team_member_ids by a database trigger),
// so direct project-level writes are silently overwritten on the next
// task edit — see bug 7c90758b. The viewing-mode sidebar TEAM section
// is the canonical read; this surface mirrors it inside the editor so
// dispatchers don't bounce back to viewing mode just to confirm the
// roster. (bug 9b0f2305)

const VISIBILITY_VALUE_KEY: Record<string, string> = {
  all: "schedule.visibility.options.all",
  office: "schedule.visibility.options.office",
  private: "schedule.visibility.options.private",
};

const STATUS_VALUE_KEY: Record<string, string> = {
  [ProjectStatus.RFQ]: "schedule.status.options.rfq",
  [ProjectStatus.Estimated]: "schedule.status.options.estimated",
  [ProjectStatus.Accepted]: "schedule.status.options.accepted",
  [ProjectStatus.InProgress]: "schedule.status.options.inProgress",
  [ProjectStatus.Completed]: "schedule.status.options.completed",
  [ProjectStatus.Closed]: "schedule.status.options.closed",
};

const STATUS_ORDER: ProjectStatus[] = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function diffDaysInclusive(start: string, end: string): number | null {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  if (e.getTime() < s.getTime()) return null;
  // End-minus-start + 1 — matches the iOS scheduler convention: a 1-day
  // job has Start === End and a duration of 1.
  return Math.round((e.getTime() - s.getTime()) / MS_PER_DAY) + 1;
}

const MONO_INPUT_CLASS =
  "font-mono text-[13px] tracking-[0.04em] [font-feature-settings:'tnum'_1,'zero'_1]";

export interface ScheduleTabProps {
  /** Drives which optional sections render. The TEAM summary only shows in
   *  editing mode because creating mode has no project id to query yet.
   *  Defaults to "creating" so legacy callers that don't pass mode (older
   *  unit-test harnesses) keep working without a TEAM rail. */
  mode?: EditCreateMode;
  /** Editing-mode project id. Null for creating mode. */
  projectId?: string | null;
}

export function ScheduleTab({
  mode = "creating",
  projectId = null,
}: ScheduleTabProps = {}) {
  const { t } = useDictionary("project-workspace");
  const {
    register,
    control,
    setValue,
  } = useFormContext<ProjectEditCreateFormValues>();

  const visibilityOptions = React.useMemo(
    () => [
      { value: "all", label: t(VISIBILITY_VALUE_KEY.all) },
      { value: "office", label: t(VISIBILITY_VALUE_KEY.office) },
      { value: "private", label: t(VISIBILITY_VALUE_KEY.private) },
    ],
    [t],
  );

  const statusOptions = React.useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        value: status,
        label: t(STATUS_VALUE_KEY[status]),
      })),
    [t],
  );

  // Watch start + end so we can auto-fill duration. We only auto-fill
  // when the operator hasn't manually set duration — track that with a
  // ref so a manual override survives subsequent date edits.
  const start = useWatch({ control, name: "startDate" });
  const end = useWatch({ control, name: "endDate" });
  const manualDurationRef = React.useRef(false);

  React.useEffect(() => {
    if (manualDurationRef.current) return;
    const derived = diffDaysInclusive(start, end);
    setValue("duration", derived != null ? String(derived) : "");
  }, [start, end, setValue]);

  const endIsBeforeStart =
    !!start &&
    !!end &&
    new Date(end).getTime() < new Date(start).getTime();

  // Watch the form's status so the swatch in the Field label updates
  // immediately when the operator picks a new value — without it the dot
  // colour would lag behind the dropdown by one render.
  const status = useWatch({ control, name: "status" });

  return (
    <Stack gap={3} data-testid="schedule-tab">
      <Section title={t("schedule.section")}>
        <Stack gap={2}>
          <Field label={t("schedule.status.label")} hint={t("schedule.status.hint")}>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <div
                  data-testid="schedule-status-wrapper"
                  className="flex items-center gap-2"
                >
                  <span
                    aria-hidden="true"
                    data-testid="schedule-status-dot"
                    className="h-2 w-2 rounded-full border border-glass-border shrink-0"
                    style={{
                      backgroundColor:
                        PROJECT_STATUS_COLORS[status as ProjectStatus] ??
                        PROJECT_STATUS_COLORS[ProjectStatus.RFQ],
                    }}
                  />
                  <div className="flex-1">
                    <Select
                      options={statusOptions}
                      value={field.value}
                      onChange={(v) =>
                        field.onChange(v as ProjectEditCreateFormValues["status"])
                      }
                      placeholder={t("schedule.status.placeholder")}
                    />
                  </div>
                </div>
              )}
            />
          </Field>

          <FieldRow
            gap={2}
            columns={["1fr", "1fr", "1fr"]}
            data-testid="schedule-grid"
          >
            <div data-testid="schedule-cell-start">
              <Field label={t("schedule.start.label")}>
                <TextInput
                  {...register("startDate")}
                  type="date"
                  className={MONO_INPUT_CLASS}
                />
              </Field>
            </div>

            <div data-testid="schedule-cell-end">
              <Field
                label={t("schedule.end.label")}
                error={
                  endIsBeforeStart
                    ? t("schedule.end.errorBeforeStart")
                    : undefined
                }
                data-testid={
                  endIsBeforeStart ? "schedule-end-error-wrapper" : undefined
                }
              >
                <TextInput
                  {...register("endDate")}
                  type="date"
                  className={MONO_INPUT_CLASS}
                />
              </Field>
              {endIsBeforeStart && (
                <span
                  data-testid="schedule-end-error"
                  className="sr-only"
                  role="status"
                >
                  {t("schedule.end.srOnlyError")}
                </span>
              )}
            </div>

            <div data-testid="schedule-cell-duration">
              <Field label={t("schedule.duration.label")} hint={t("schedule.duration.hint")}>
                <TextInput
                  {...register("duration", {
                    onChange: () => {
                      manualDurationRef.current = true;
                    },
                  })}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="—"
                  className={MONO_INPUT_CLASS}
                />
              </Field>
            </div>
          </FieldRow>

          <Field label={t("schedule.visibility.label")}>
            <Controller
              control={control}
              name="visibility"
              render={({ field }) => (
                <Segmented
                  options={visibilityOptions}
                  value={field.value}
                  onChange={(v) =>
                    field.onChange(v as ProjectEditCreateFormValues["visibility"])
                  }
                />
              )}
            />
          </Field>
        </Stack>
      </Section>

      {mode === "editing" && projectId ? (
        <TeamSummarySection projectId={projectId} />
      ) : null}
    </Stack>
  );
}

ScheduleTab.displayName = "ScheduleTab";

// ─── TeamSummarySection ─────────────────────────────────────────────────────
//
// Read-only snapshot of the project's current team plus a deliberate hint
// that team assignments are owned by tasks. The bug from the QA audit was
// that the editor surface had NO team rail at all — operators were forced
// to flip to viewing mode just to confirm the roster, and there was no
// indication of how to change it. This panel solves the visibility gap
// without re-introducing the broken project-level write path that bug
// 7c90758b removed.

function TeamSummarySection({ projectId }: { projectId: string }) {
  const { t } = useDictionary("project-workspace");
  const { members } = useProjectTeam(projectId);

  return (
    <Section
      title={t("scheduleTeam.section")}
      rightSlot={
        <Mono color="text-3" size={9}>{`${members.length}`}</Mono>
      }
    >
      <Stack gap={1.5}>
        {members.length === 0 ? (
          <Body size={14} color="text-3" className="py-1">
            {t("scheduleTeam.empty")}
          </Body>
        ) : (
          <ul
            data-testid="schedule-team-list"
            className="flex flex-col gap-1"
          >
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-baseline justify-between gap-2"
              >
                <Body size={14} color="text">
                  {m.name}
                </Body>
                {m.taskTypeNames.length > 0 ? (
                  <Mono size={11} color="text-3" className="truncate">
                    {m.taskTypeNames.join(" · ")}
                  </Mono>
                ) : (
                  <Mono size={11} color="text-3">
                    {t("scheduleTeam.unassigned")}
                  </Mono>
                )}
              </li>
            ))}
          </ul>
        )}

        <div
          className="rounded-[5px] border border-glass-border px-2 py-1.5"
          data-testid="schedule-team-callout"
        >
          <Mono size={11} color="text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("scheduleTeam.callout")}
          </Mono>
        </div>
      </Stack>
    </Section>
  );
}
