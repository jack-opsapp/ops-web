"use client";

import * as React from "react";
import { FormProvider, useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useProject } from "@/lib/hooks/use-projects";
import { useProjectMutations } from "@/lib/hooks/use-project-mutations";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
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
  /**
   * Preselects the client field in creating mode (window meta seed from
   * `/projects/new?clientId=` or the client-list widget). Editing mode
   * ignores it — the loaded project owns clientId there.
   */
  initialClientId?: string | null;
  /** Active tab — driven by the parent shell's ModalTabs. */
  tab: EditCreateTabId;
  /** Stable id used by the footer button's `form="..."` attribute. */
  formId: string;
  /** Fires after a successful save/create with the resulting project id. */
  onSaved?: (projectId: string) => void;
  /**
   * Fires when submit fails validation, with the tab that renders the first
   * erroring field. The footer's CTA submits from outside the form, so the
   * failing field's error may live on the tab that is NOT mounted (e.g. trade
   * is required for creating but its error renders in the identity tab) —
   * without this report the click dead-ends with zero feedback. The container
   * wires it to its tab state so the failure becomes visible.
   */
  onInvalid?: (tabWithError: EditCreateTabId) => void;
  /** Ref the workspace container reads to trigger DISCARD CHANGES. */
  discardRef?: React.Ref<ProjectEditCreateBodyHandle>;
  className?: string;
}

const VISIBILITY_VALUES = ["all", "office", "private"] as const;
const TRADE_VALUES = ["roofing", "hvac", "plumbing"] as const;

// Form schema factory — values follow the Project model. clientId is
// nullable because creating-mode workflows can defer client linkage.
// Address is optional but, when present, must travel with lat+lon (the
// autocomplete hands them over together; manual entry without geocoding
// is not supported by this surface).
//
// Trade is nullable in editing mode so legacy projects (created before
// the column existed) save without forcing a backfill. Creating mode
// requires it so every new project captures a category up front.
//
// Schema is a factory because Zod messages need to land in the active
// locale — the body resolves the t() function and re-builds the schema
// on locale change via useMemo.
export function buildEditingSchema(messages: { titleTooLong: string }) {
  return z.object({
    // Title is OPTIONAL on both surfaces now: blank ⇒ auto-named from the
    // address by the DB trigger (titleIsAuto=true). Only `titleTooLong` survives
    // as a guard; `titleRequired` is retired from the create + edit paths.
    title: z.string().max(200, messages.titleTooLong).optional(),
    /** True ⇒ the name auto-tracks the address; false ⇒ a hand-typed name. */
    titleIsAuto: z.boolean(),
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
}

export function buildCreatingSchema(messages: {
  titleTooLong: string;
  tradeRequired: string;
}) {
  return buildEditingSchema(messages).extend({
    trade: z.enum(TRADE_VALUES, {
      errorMap: () => ({ message: messages.tradeRequired }),
    }),
  });
}

export type ProjectEditCreateFormValues = z.infer<
  ReturnType<typeof buildEditingSchema>
>;

// Every schema field, in schema order, mapped to the tab that renders its
// error. The invalid-submit report picks the first erroring field's tab so
// the container can flip somewhere the failure is actually visible.
const FIELD_TAB: ReadonlyArray<
  [keyof ProjectEditCreateFormValues, EditCreateTabId]
> = [
  ["title", "identity"],
  ["titleIsAuto", "identity"],
  ["clientId", "identity"],
  ["address", "identity"],
  ["latitude", "identity"],
  ["longitude", "identity"],
  ["projectDescription", "identity"],
  ["trade", "identity"],
  ["startDate", "schedule"],
  ["endDate", "schedule"],
  ["duration", "schedule"],
  ["visibility", "schedule"],
];

const EMPTY_DEFAULTS: ProjectEditCreateFormValues = {
  title: "",
  // New projects auto-name from their address by default — the operator never
  // types a name unless they open `rename`.
  titleIsAuto: true,
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

/**
 * Collapse the form's (title, titleIsAuto) into what the DB expects. The name
 * is auto when the operator left it on auto OR cleared a custom name; otherwise
 * the typed name is frozen. When auto, `title` is omitted so the BEFORE-write
 * trigger derives it from the address.
 */
function resolveTitleFields(values: ProjectEditCreateFormValues): {
  title: string | undefined;
  titleIsAuto: boolean;
} {
  const typed = values.title?.trim() ?? "";
  const isAuto = values.titleIsAuto || typed === "";
  return { title: isAuto ? undefined : typed, titleIsAuto: isAuto };
}

function PermissionDeniedState() {
  const { t } = useDictionary("project-workspace");
  return (
    <div
      data-testid="project-edit-create-body-denied"
      className="flex h-full items-center justify-center px-6"
    >
      <Stack gap={1} align="center">
        <Mono size={11} color="text-3">
          {t("editCreate.accessDenied.title")}
        </Mono>
        <Body size={14} color="text-3">
          {t("editCreate.accessDenied.body")}
        </Body>
      </Stack>
    </div>
  );
}

function LoadingState() {
  const { t } = useDictionary("project-workspace");
  return (
    <div
      data-testid="project-edit-create-body-loading"
      className="flex h-full items-center justify-center"
    >
      <Body size={14} color="text-3">
        {t("editCreate.loading")}
      </Body>
    </div>
  );
}

export function ProjectEditCreateBody({
  mode,
  projectId,
  initialClientId = null,
  tab,
  formId,
  onSaved,
  onInvalid,
  discardRef,
  className,
}: ProjectEditCreateBodyProps) {
  const { t } = useDictionary("project-workspace");
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
    // Creating mode seeds the client from the window meta (e.g. the
    // `/projects/new?clientId=` deep link); everything else starts empty.
    if (!isEditing) return { ...EMPTY_DEFAULTS, clientId: initialClientId ?? null };
    if (!project) return EMPTY_DEFAULTS;
    return {
      title: project.title ?? "",
      titleIsAuto: project.titleIsAuto ?? false,
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
  }, [isEditing, project, initialClientId]);

  const schema = React.useMemo(() => {
    const messages = {
      titleTooLong: t("editCreate.errors.titleTooLong"),
      tradeRequired: t("identity.trade.required"),
    };
    return isEditing
      ? buildEditingSchema(messages)
      : buildCreatingSchema(messages);
  }, [isEditing, t]);

  const form = useForm<ProjectEditCreateFormValues>({
    resolver: zodResolver(schema),
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

  // Creating-mode mirror of the editing reset above, scoped to the client
  // seed: the singleton creating window survives "Create Project on client
  // A, then client B" as a refocus (no remount), so a changed seed lands
  // via setValue. Skipped once the operator touches the field — a refocus
  // must never clobber a hand-picked client.
  React.useEffect(() => {
    if (isEditing) return;
    if (form.getFieldState("clientId").isDirty) return;
    form.setValue("clientId", initialClientId ?? null);
  }, [isEditing, initialClientId, form]);

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

  // Validation failure is never a silent dead-end: report the tab that
  // renders the first erroring field so the container can flip to it and
  // the field's inline error is actually on screen.
  const handleInvalid = React.useCallback(
    (fieldErrors: FieldErrors<ProjectEditCreateFormValues>) => {
      const errored = FIELD_TAB.find(([name]) => fieldErrors[name]);
      if (errored) onInvalid?.(errored[1]);
    },
    [onInvalid],
  );

  const handleSubmit = form.handleSubmit(async (values) => {
    // Resolve the name into the (title, titleIsAuto) the DB expects: auto when
    // the operator left it on auto OR cleared a custom name; otherwise the typed
    // name is frozen (titleIsAuto=false). When auto, `title` is omitted so the
    // trigger derives it from the address.
    const { title, titleIsAuto } = resolveTitleFields(values);

    if (isEditing) {
      if (!projectId) return;
      await mutations.saveProject.mutateAsync({
        projectId,
        patch: {
          title,
          titleIsAuto,
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
      title,
      titleIsAuto,
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
  }, handleInvalid);

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
            <input
              type="checkbox"
              data-testid="project-edit-create-body-test-title-is-auto"
              {...form.register("titleIsAuto")}
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
