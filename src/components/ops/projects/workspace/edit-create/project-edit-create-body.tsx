"use client";

import * as React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useProject } from "@/lib/hooks/use-projects";
import { useProjectMutations } from "@/lib/hooks/use-project-mutations";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { cn } from "@/lib/utils/cn";
import { IdentityTab } from "./identity-tab";
import { ScheduleTab } from "./schedule-tab";

// `ProjectEditCreateBody` — the body slot of the workspace shell when the
// active mode is `editing` or `creating`. It owns the react-hook-form
// state shared across IdentityTab and ScheduleTab and dispatches form
// submission to the right mutation:
//
//   editing  → useProjectMutations.saveProject
//   creating → useProjectMutations.createProject
//
// The composer renders a single `<form>` with a stable `id` so the
// workspace footer (rendered by the shell) can drive submit via the
// HTML `form="..."` attribute on its CTA button. This decouples the
// footer from the form state — wiring lands in Phase 9.
//
// Permission gating is granular: editing requires `projects.edit`,
// creating requires `projects.create`. Role-based filtering is never
// used.

export type EditCreateMode = "editing" | "creating";
export type EditCreateTabId = "identity" | "schedule";

// Imperative handle the workspace footer's DISCARD CHANGES action grabs.
// Resets the form's dirty values back to the editing defaults (or empty
// for creating mode). Exposed via useImperativeHandle so the body owns
// the form state, not the footer.
export interface ProjectEditCreateBodyHandle {
  discard: () => void;
}

export interface ProjectEditCreateBodyProps {
  mode: EditCreateMode;
  /** Required when mode is "editing"; null/undefined for "creating". */
  projectId: string | null;
  /** Active tab — driven by the parent shell's ModalTabs. */
  tab: EditCreateTabId;
  /** Stable id used by the footer button's `form="..."` attribute. */
  formId: string;
  /** Fires after a successful save/create with the resulting project id. */
  onSaved?: (projectId: string) => void;
  /** Ref the workspace container reads to trigger DISCARD CHANGES. */
  discardRef?: React.Ref<ProjectEditCreateBodyHandle>;
  className?: string;
}

const VISIBILITY_VALUES = ["all", "office", "private"] as const;
const TRADE_VALUES = ["roofing", "hvac", "plumbing"] as const;

// Form schema — values follow the Project model. clientId is nullable
// because creating-mode workflows can defer client linkage. Address is
// optional but, when present, must travel with lat+lon (the autocomplete
// hands them over together; manual entry without geocoding is not
// supported by this surface).
//
// Trade is nullable in editing mode so legacy projects (created before
// the column existed) save without forcing a backfill. Creating mode
// requires it so every new project captures a category up front — see
// `creatingSchema` below.
const editingSchema = z.object({
  title: z
    .string()
    .min(1, "Project name is required")
    .max(200, "Name too long"),
  clientId: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  projectDescription: z.string().nullable(),
  trade: z.enum(TRADE_VALUES).nullable(),
  startDate: z.string(),
  endDate: z.string(),
  duration: z.string(),
  visibility: z.enum(VISIBILITY_VALUES),
});

const creatingSchema = editingSchema.extend({
  trade: z.enum(TRADE_VALUES, {
    errorMap: () => ({ message: "Trade is required" }),
  }),
});

export type ProjectEditCreateFormValues = z.infer<typeof editingSchema>;

const EMPTY_DEFAULTS: ProjectEditCreateFormValues = {
  title: "",
  clientId: null,
  address: null,
  latitude: null,
  longitude: null,
  projectDescription: null,
  trade: null,
  startDate: "",
  endDate: "",
  duration: "",
  visibility: "all",
};

function toIsoDate(value: Date | null | undefined): string {
  if (!value) return "";
  // ISO-8601 yyyy-mm-dd — what `<input type="date">` expects and what the
  // workspace mono date inputs render.
  return value.toISOString().slice(0, 10);
}

function fromIsoDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function PermissionDeniedState() {
  return (
    <div
      data-testid="project-edit-create-body-denied"
      className="flex h-full items-center justify-center px-6"
    >
      <Stack gap={1} align="center">
        <Mono size={11} color="text-3">
          {"// ACCESS DENIED"}
        </Mono>
        <Body size={14} color="text-3">
          You don&apos;t have permission to modify this project.
        </Body>
      </Stack>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      data-testid="project-edit-create-body-loading"
      className="flex h-full items-center justify-center"
    >
      <Body size={14} color="text-3">
        Loading…
      </Body>
    </div>
  );
}

export function ProjectEditCreateBody({
  mode,
  projectId,
  tab,
  formId,
  onSaved,
  discardRef,
  className,
}: ProjectEditCreateBodyProps) {
  const can = usePermissionStore((s) => s.can);
  const isEditing = mode === "editing";
  const isAllowed = isEditing ? can("projects.edit") : can("projects.create");

  // Editing mode loads the project so we can seed defaults; creating
  // mode skips the fetch entirely (projectId is null).
  const { data: project, isLoading } = useProject(
    isEditing && projectId ? projectId : undefined,
  );
  const mutations = useProjectMutations(projectId);

  const defaults = React.useMemo<ProjectEditCreateFormValues>(() => {
    if (!isEditing || !project) return EMPTY_DEFAULTS;
    return {
      title: project.title ?? "",
      clientId: project.clientId ?? null,
      address: project.address ?? null,
      latitude: project.latitude ?? null,
      longitude: project.longitude ?? null,
      projectDescription: project.projectDescription ?? null,
      trade: project.trade ?? null,
      startDate: toIsoDate(project.startDate),
      endDate: toIsoDate(project.endDate),
      duration: project.duration != null ? String(project.duration) : "",
      visibility: project.visibility ?? "all",
    };
    // The project reference is the cache key; safe to depend on directly.
  }, [isEditing, project]);

  const form = useForm<ProjectEditCreateFormValues>({
    resolver: zodResolver(isEditing ? editingSchema : creatingSchema),
    defaultValues: defaults,
    // Re-validate on blur so error states match the field that just lost focus.
    mode: "onBlur",
  });

  // When the project loads (editing) reset the form to the new defaults.
  // Creating mode keeps the empty defaults stable across tab swaps.
  const lastSeededRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!isEditing) return;
    if (!project) return;
    if (lastSeededRef.current === project.id) return;
    lastSeededRef.current = project.id;
    form.reset(defaults);
  }, [isEditing, project, defaults, form]);

  // Expose imperative `discard()` for the workspace footer's DISCARD
  // CHANGES button. Editing mode resets to the loaded project's
  // defaults; creating mode resets to the empty payload. Either way,
  // dirty state clears.
  React.useImperativeHandle(
    discardRef,
    () => ({
      discard: () => form.reset(defaults),
    }),
    [form, defaults],
  );

  const handleSubmit = form.handleSubmit(async (values) => {
    if (isEditing) {
      if (!projectId) return;
      await mutations.saveProject.mutateAsync({
        projectId,
        patch: {
          title: values.title,
          clientId: values.clientId,
          address: values.address,
          latitude: values.latitude,
          longitude: values.longitude,
          projectDescription: values.projectDescription,
          trade: values.trade,
          startDate: fromIsoDate(values.startDate),
          endDate: fromIsoDate(values.endDate),
          duration: values.duration ? Number(values.duration) : null,
          visibility: values.visibility,
        },
      });
      onSaved?.(projectId);
      return;
    }

    const created = await mutations.createProject.mutateAsync({
      title: values.title,
      clientId: values.clientId,
      address: values.address,
      latitude: values.latitude,
      longitude: values.longitude,
      projectDescription: values.projectDescription,
      trade: values.trade,
      startDate: fromIsoDate(values.startDate),
      endDate: fromIsoDate(values.endDate),
      visibility: values.visibility,
    });
    onSaved?.(created.id);
  });

  if (!isAllowed) {
    return <PermissionDeniedState />;
  }

  if (isEditing && isLoading) {
    return <LoadingState />;
  }

  return (
    <form
      id={formId}
      data-testid="project-edit-create-form"
      onSubmit={handleSubmit}
      noValidate
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      <FormProvider {...form}>
        {/* Hidden test handles for harness-driven inputs. Only rendered
            in test environments — keeps creating-mode submission unit-
            testable without depending on the IdentityTab's inputs.
            Trade is text-registered here because creating-mode validation
            requires it, and the Radix Select is not trivial to drive
            from the body-level test stubs. */}
        {process.env.NODE_ENV === "test" && (
          <>
            <input
              type="text"
              data-testid="project-edit-create-body-test-title"
              {...form.register("title")}
              style={{ position: "absolute", left: -9999, width: 1, height: 1 }}
              aria-hidden="true"
              tabIndex={-1}
            />
            <input
              type="text"
              data-testid="project-edit-create-body-test-trade"
              {...form.register("trade")}
              style={{ position: "absolute", left: -9999, width: 1, height: 1 }}
              aria-hidden="true"
              tabIndex={-1}
            />
          </>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "identity" ? <IdentityTab mode={mode} /> : <ScheduleTab />}
        </div>
      </FormProvider>
    </form>
  );
}

ProjectEditCreateBody.displayName = "ProjectEditCreateBody";
