"use client";

import * as React from "react";
import {
  useWindowStore,
  consumeProjectCreatedCallback,
} from "@/stores/window-store";
import { useProject } from "@/lib/hooks/use-projects";
import { useProjectMutations } from "@/lib/hooks/use-project-mutations";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { ProjectStatus } from "@/lib/types/models";
import { useDictionary } from "@/i18n/client";
import { ProjectViewingBody } from "./viewing/project-viewing-body";
import { ProjectSidebar } from "./viewing/project-sidebar";
import {
  ProjectEditCreateBody,
  type EditCreateTabId,
  type ProjectEditCreateBodyHandle,
} from "./edit-create/project-edit-create-body";
import { ProjectWorkspaceWindow } from "./shell/project-workspace-window";
import { ConfirmModal } from "./confirm-modal";
import type { ModeFooterConfig } from "./shell/mode-footer";
import type { ChipVariant } from "./atoms/chip";
import type { WorkspaceMode } from "./shell/mode-pill";
import type {
  ProjectWorkspaceMode,
  ProjectWorkspaceWindowMeta,
} from "@/stores/window-store";

// `<ProjectWorkspaceContainer>` — Phase 9.3 deliverable.
//
// Mediates between the slim `useWindowStore` window state (id + meta)
// and the rich `<ProjectWorkspaceWindow>` shell prop API. Owns mode
// (viewing/editing/creating), active tab, the form-id wiring for the
// SAVE button, and the meta-update path after a successful create.
//
// One container instance per project-workspace window. Mounted by
// `<FloatingWindows>` in the dashboard layout.

interface ProjectWorkspaceContainerProps {
  windowId: string;
}

const EDIT_CREATE_TAB_IDS = ["identity", "schedule"] as const;
const EDIT_CREATE_TAB_KEY: Record<EditCreateTabId, string> = {
  identity: "tabs.identity",
  schedule: "tabs.schedule",
};

// Status → chip tone. Mirrors the dashboard's status-badge palette but
// in the workspace's chip vocabulary (neutral / accent / olive / tan /
// rose). Closed and Archived share the rose tone — both signal "this
// project is no longer in active rotation."
function statusToChipVariant(status: ProjectStatus): ChipVariant {
  switch (status) {
    case ProjectStatus.Accepted:
    case ProjectStatus.Completed:
      return "olive";
    case ProjectStatus.InProgress:
      return "tan";
    case ProjectStatus.Closed:
    case ProjectStatus.Archived:
      return "rose";
    default:
      return "neutral";
  }
}

// `ProjectWorkspaceMode` (creating/editing/viewing) and the shell's
// `WorkspaceMode` are nominally identical — re-derive to keep the type
// checker honest if either drifts.
function asWorkspaceMode(m: ProjectWorkspaceMode): WorkspaceMode {
  return m;
}

export function ProjectWorkspaceContainer({
  windowId,
}: ProjectWorkspaceContainerProps) {
  const { t } = useDictionary("project-workspace");
  const win = useWindowStore((s) =>
    s.windows.find((w) => w.id === windowId && w.type === "project-workspace"),
  );
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const updateWindowMeta = useWindowStore((s) => s.updateWindowMeta);

  // Window type is narrowed in the selector above, so meta is the project
  // variant of the WorkspaceWindowMeta union.
  const meta = win?.meta as ProjectWorkspaceWindowMeta | undefined;
  const projectId = meta?.projectId ?? null;
  const initialMode: ProjectWorkspaceMode = meta?.initialMode ?? "viewing";
  const initialClientId = meta?.initialClientId ?? null;

  // Local mode owns the live viewing→editing→viewing loop. Initialised
  // from the store's meta and re-synced when the meta changes (e.g. a
  // notification deep-link reopening the same window in a different
  // mode).
  const [mode, setMode] = React.useState<ProjectWorkspaceMode>(initialMode);
  React.useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const [activeTab, setActiveTab] = React.useState<EditCreateTabId>("identity");

  // Stable form id — the `form="..."` attribute on the SAVE button
  // associates the footer button with the composer's <form>. Using
  // useId keeps the value stable across re-renders and unique per
  // window instance, so two open workspaces don't clash.
  const reactId = React.useId();
  const formId = `project-workspace-form-${reactId}`;

  // Imperative handle to the composer's discard. The footer's DISCARD
  // CHANGES action calls .current?.discard() to reset dirty form state.
  const composerRef = React.useRef<ProjectEditCreateBodyHandle | null>(null);

  // Editing mode loads the project so we can derive title/status chrome
  // and the archive recipient list. Creating mode skips the fetch.
  const { data: project } = useProject(
    projectId && mode !== "creating" ? projectId : undefined,
  );
  const mutations = useProjectMutations(projectId);

  const handleSaved = React.useCallback(
    (savedProjectId: string) => {
      if (mode === "creating") {
        // Fire the parent-supplied onProjectCreated callback first, so
        // the parent surface (e.g. the in-task-modal project selector)
        // observes the new id synchronously before this window swaps
        // meta + transitions to viewing. Wrapped: a thrown callback
        // must not block the meta swap — the parent owns its own
        // failure handling.
        try {
          consumeProjectCreatedCallback(windowId, savedProjectId);
        } catch (err) {
          console.error("onProjectCreated callback threw", err);
        }
        // Creating → viewing transition. Update the window meta so the
        // window's id sentinel ("project-workspace:new") points at the
        // freshly minted project, and any subsequent re-open from a
        // deep-link / FAB / dock-restore lands on this same window.
        updateWindowMeta(windowId, {
          projectId: savedProjectId,
          initialMode: "viewing",
        });
      }
      setMode("viewing");
    },
    [mode, updateWindowMeta, windowId],
  );

  // Archive flow is a two-step gate: clicking the footer's destructive
  // ARCHIVE button opens a ConfirmModal, the modal's confirm button fires
  // the mutation. Decoupled state keeps the modal closeable mid-flight.
  const [confirmArchiveOpen, setConfirmArchiveOpen] = React.useState(false);
  const can = usePermissionStore((s) => s.can);
  // projects.archive is the canonical permission for this action; if it's
  // not granted to the operator, the destructive button is hidden entirely
  // (not disabled — operators don't need to see actions they cannot take).
  const canArchive = can("projects.archive");

  const openConfirmArchive = React.useCallback(() => {
    if (!project || !projectId) return;
    setConfirmArchiveOpen(true);
  }, [project, projectId]);

  const handleConfirmArchive = React.useCallback(() => {
    if (!project || !projectId) return;
    mutations.archiveProject.mutate(
      {
        projectId,
        projectTitle: project.title,
        notifyUserIds: project.teamMemberIds ?? [],
      },
      {
        onSuccess: () => {
          setConfirmArchiveOpen(false);
          setMode("viewing");
        },
      },
    );
  }, [mutations.archiveProject, project, projectId]);

  if (!win) return null;

  const isViewing = mode === "viewing";
  const isEditing = mode === "editing";
  const isCreating = mode === "creating";

  // Display chrome — derived from project for editing/viewing, static
  // placeholders for creating.
  const title = isCreating
    ? t("title.newProject")
    : project?.title ?? t("title.loading");
  // Crumb is rendered inside `<Mono>` which auto-uppercases via CSS, so
  // pass the natural-case title — let the atom handle the visual transform.
  const crumbLabel = isCreating
    ? t("crumb.newProject")
    : project?.title ?? t("crumb.fallback");
  const projectIdLabel = projectId
    ? projectId.slice(0, 8).toUpperCase()
    : "—";
  const statusLabel = isCreating
    ? t("status.draft")
    : project
      ? project.status.toUpperCase()
      : "—";
  const statusTone: ChipVariant = isCreating
    ? "accent"
    : project
      ? statusToChipVariant(project.status)
      : "neutral";

  // Footer config per mode. The brand rule (one primary CTA per
  // surface) is enforced by ModeFooterConfig's type.
  let footerConfig: ModeFooterConfig;
  if (isViewing) {
    footerConfig = {
      secondary: [],
      primary: {
        label: t("footer.edit"),
        onClick: () => setMode("editing"),
        disabled: !project,
      },
    };
  } else if (isEditing) {
    footerConfig = {
      // ARCHIVE is hidden — not just disabled — for operators without
      // projects.archive. They don't need to see destructive surfaces
      // they cannot trigger. Editing remains available via projects.edit
      // (gated upstream in ProjectEditCreateBody).
      destructive: canArchive
        ? {
            label: t("footer.archive"),
            onClick: openConfirmArchive,
            disabled: !project || mutations.archiveProject.isPending,
          }
        : undefined,
      secondary: [
        {
          label: t("footer.discard"),
          onClick: () => composerRef.current?.discard(),
        },
      ],
      ghost: {
        label: t("footer.cancel"),
        onClick: () => setMode("viewing"),
      },
      primary: {
        label: t("footer.save"),
        // type=submit + form= drives submission via the composer's
        // form association — no callback ref needed.
        type: "submit",
        form: formId,
        // ModeFooterAction requires onClick — the submit happens via
        // the form association above, so this is a no-op fallback.
        onClick: () => {},
        disabled: mutations.saveProject.isPending,
      },
    };
  } else {
    // creating
    footerConfig = {
      secondary: [],
      ghost: {
        label: t("footer.cancel"),
        onClick: () => closeWindow(windowId),
      },
      primary: {
        label: t("footer.create"),
        type: "submit",
        form: formId,
        onClick: () => {},
        disabled: mutations.createProject.isPending,
      },
    };
  }

  const editCreateTabs = EDIT_CREATE_TAB_IDS.map((id) => ({
    id,
    label: t(EDIT_CREATE_TAB_KEY[id]),
  }));
  const tabs = isViewing ? undefined : editCreateTabs;
  const tabActiveId = isViewing ? undefined : activeTab;
  const tabHandler = isViewing ? undefined : setActiveTab;

  return (
    <>
      <ProjectWorkspaceWindow<EditCreateTabId>
        id={windowId}
        title={title}
        crumbLabel={crumbLabel}
        projectIdLabel={projectIdLabel}
        statusLabel={statusLabel}
        statusTone={statusTone}
        mode={asWorkspaceMode(mode)}
        tabs={tabs}
        activeTabId={tabActiveId}
        onTabChange={tabHandler}
        position={win.position}
        size={win.size}
        zIndex={win.zIndex}
        footerConfig={footerConfig}
        rightRail={
          isViewing && projectId ? (
            <ProjectSidebar projectId={projectId} />
          ) : undefined
        }
      >
        {isViewing && projectId ? (
          <ProjectViewingBody projectId={projectId} />
        ) : (
          <ProjectEditCreateBody
            mode={isCreating ? "creating" : "editing"}
            projectId={isCreating ? null : projectId}
            initialClientId={initialClientId}
            tab={activeTab}
            formId={formId}
            onSaved={handleSaved}
            discardRef={composerRef}
          />
        )}
      </ProjectWorkspaceWindow>
      <ConfirmModal
        open={confirmArchiveOpen}
        onOpenChange={setConfirmArchiveOpen}
        title={t("confirm.archive.title")}
        body={
          project
            ? t("confirm.archive.body").replace("{title}", project.title)
            : t("confirm.archive.bodyFallback")
        }
        confirmLabel={t("confirm.archive.confirm")}
        cancelLabel={t("footer.cancel")}
        onConfirm={handleConfirmArchive}
        isConfirming={mutations.archiveProject.isPending}
      />
    </>
  );
}

ProjectWorkspaceContainer.displayName = "ProjectWorkspaceContainer";
