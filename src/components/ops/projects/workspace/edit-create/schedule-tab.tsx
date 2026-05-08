"use client";

import * as React from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Field } from "@/components/ops/projects/workspace/atoms/field";
import { FieldRow } from "@/components/ops/projects/workspace/atoms/field-row";
import { TextInput } from "@/components/ops/projects/workspace/atoms/text-input";
import { Segmented } from "@/components/ops/projects/workspace/atoms/segmented";
import { useDictionary } from "@/i18n/client";
import type { ProjectEditCreateFormValues } from "./project-edit-create-body";

// `ScheduleTab` — workspace edit/create schedule surface.
//
// Reads the shared form context and registers four fields:
//   startDate  → projects.start_date  (yyyy-mm-dd ISO)
//   endDate    → projects.end_date    (yyyy-mm-dd ISO)
//   duration   → derived from start/end (in days), manually overrideable
//   visibility → projects.visibility (Segmented: all/office/private)
//
// Date inputs render in JetBrains Mono (workspace tabular voice). Once
// both Start and End land, Duration is automatically populated; manually
// editing Duration replaces the derived value (the operator's number wins
// — schedule reality is messier than calendar math).
//
// Visibility maps 1:1 to the iOS-mirrored enum on `projects.visibility`.

const VISIBILITY_VALUE_KEY: Record<string, string> = {
  all: "schedule.visibility.options.all",
  office: "schedule.visibility.options.office",
  private: "schedule.visibility.options.private",
};

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

export function ScheduleTab() {
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

  return (
    <Stack gap={3} data-testid="schedule-tab">
      <Section title={t("schedule.section")}>
        <Stack gap={2}>
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
    </Stack>
  );
}

ScheduleTab.displayName = "ScheduleTab";
