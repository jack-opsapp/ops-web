"use client";

import * as React from "react";
import {
  useWindowStore,
  consumeProjectCreatedCallback,
} from "@/stores/window-store";
import { useProject } from "@/lib/hooks/use-projects";
import { useProjectMutations } from "@/lib/hooks/use-project-mutations";
import { ProjectStatus } from "@/lib/types/models";
import { ProjectViewingBody } from "./viewing/project-viewing-body";
import { ProjectSidebar } from "./viewing/project-sidebar";
import {
  ProjectEditCreateBody,
  type EditCreateTabId,
  type ProjectEditCreateBodyHandle,
} from "./edit-create/project-edit-create-body";
import { ProjectWorkspaceWindow } from "./shell/project-workspace-window";
import type { ModeFooterConfig } from "./shell/mode-footer";
import type { ChipVariant } from "./atoms/chip";
import type { WorkspaceMode } from "./shell/mode-pill";
import type { ProjectWorkspaceMode } from "@/stores/window-store";

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

const EDIT_CREATE_TABS = [
  { id: "identity" as const, label: "IDENTITY" },
  { id: "schedule" as const, label: "SCHEDULE" },
];

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
  const win = useWindowStore((s) =>
    s.windows.find((w) => w.id === windowId && w.type === "project-workspace"),
  );
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const updateWindowMeta = useWindowStore((s) => s.updateWindowMeta);

  const meta = win?.meta;
  const projectId = meta?.projectId ?? null;
  const initialMode: ProjectWorkspaceMode = meta?.initialMode ?? "viewing";

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

  const handleArchive = React.useCallback(() => {
    if (!project || !projectId) return;
    mutations.archiveProject.mutate({
      projectId,
      projectTitle: project.title,
      notifyUserIds: project.teamMemberIds ?? [],
    });
  }, [mutations.archiveProject, project, projectId]);

  if (!win) return null;

  const isViewing = mode === "viewing";
  const isEditing = mode === "editing";
  const isCreating = mode === "creating";

  // Display chrome — derived from project for editing/viewing, static
  // placeholders for creating.
  const title = isCreating
    ? "NEW PROJECT"
    : project?.title ?? "Loading…";
  // Crumb is rendered inside `<Mono>` which auto-uppercases via CSS, so
  // pass the natural-case title — let the atom handle the visual transform.
  const crumbLabel = isCreating
    ? "New Project"
    : project?.title ?? "Project";
  const projectIdLabel = projectId
    ? projectId.slice(0, 8).toUpperCase()
    : "—";
  const statusLabel = isCreating
    ? "DRAFT"
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
        label: "EDIT",
        onClick: () => setMode("editing"),
        disabled: !project,
      },
    };
  } else if (isEditing) {
    footerConfig = {
      destructive: {
        label: "ARCHIVE",
        onClick: handleArchive,
        disabled: !project || mutations.archiveProject.isPending,
      },
      secondary: [
        {
          label: "DISCARD CHANGES",
          onClick: () => composerRef.current?.discard(),
        },
      ],
      ghost: {
        label: "CANCEL",
        onClick: () => setMode("viewing"),
      },
      primary: {
        label: "SAVE",
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
        label: "CANCEL",
        onClick: () => closeWindow(windowId),
      },
      primary: {
        label: "CREATE",
        type: "submit",
        form: formId,
        onClick: () => {},
        disabled: mutations.createProject.isPending,
      },
    };
  }

  const tabs = isViewing ? undefined : EDIT_CREATE_TABS;
  const tabActiveId = isViewing ? undefined : activeTab;
  const tabHandler = isViewing ? undefined : setActiveTab;

  return (
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
          tab={activeTab}
          formId={formId}
          onSaved={handleSaved}
          discardRef={composerRef}
        />
      )}
    </ProjectWorkspaceWindow>
  );
}

ProjectWorkspaceContainer.displayName = "ProjectWorkspaceContainer";
