"use client";

import { create } from "zustand";

export type FloatingWindowType =
  | "create-task"
  | "create-estimate"
  | "create-lead"
  | "compose-email"
  | "pipeline-detail"
  | "project-workspace"
  | "client-workspace";

// Mode passed into the project workspace shell on open. The body composer
// re-reads this from `meta` on mount, then owns the live mode locally so
// the user can switch viewing → editing without re-opening the window.
export type ProjectWorkspaceMode = "viewing" | "editing" | "creating";

export interface ProjectWorkspaceWindowMeta {
  // null sentinels the create-new flow — the workspace renders the
  // edit/create body without prefilling from a Supabase row.
  projectId: string | null;
  initialMode: ProjectWorkspaceMode;
  // Seeds the create form's client field (route consolidation 2026-07-03:
  // `/projects/new?clientId=` and the client-list widget's "Create Project"
  // action). Creating mode only — viewing/editing ignore it. Optional so
  // `updateWindowMeta` callers swapping in a post-create meta can omit it;
  // `openProjectWindow` always writes it (null when unseeded) so a refocus
  // replaces any previous seed rather than leaking it.
  initialClientId?: string | null;
}

// Client workspace mirrors the project workspace contract (WEB OVERHAUL
// P3.3). Same three-mode loop; `clientId: null` sentinels create-new.
export type ClientWorkspaceMode = "viewing" | "editing" | "creating";

export interface ClientWorkspaceWindowMeta {
  clientId: string | null;
  initialMode: ClientWorkspaceMode;
}

// Strongly-typed window metadata is a union discriminated by `type`:
// project-workspace windows carry ProjectWorkspaceWindowMeta, client-
// workspace windows carry ClientWorkspaceWindowMeta. Containers narrow by
// `w.type` before reading.
export type WorkspaceWindowMeta =
  | ProjectWorkspaceWindowMeta
  | ClientWorkspaceWindowMeta;

export interface FloatingWindowState {
  id: string;
  title: string;
  type: FloatingWindowType;
  isMinimized: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  /** Arbitrary data passed to the window content (e.g. composeData for email) */
  metadata?: Record<string, unknown>;
  /** Strongly-typed metadata for workspace windows (project | client). */
  meta?: WorkspaceWindowMeta;
}

interface OpenProjectWindowOpts {
  projectId?: string | null;
  mode?: ProjectWorkspaceMode;
  // Preselects a client in the creating-mode form (see
  // ProjectWorkspaceWindowMeta.initialClientId). Ignored unless the window
  // opens in creating mode.
  initialClientId?: string | null;
  // Fired once with the freshly-created project id when the workspace
  // body finishes a creating→viewing save. Lets a parent surface (e.g.
  // the in-task-modal "Create new project" affordance) react to the
  // create without subscribing to store internals.
  //
  // Stored module-side (see `projectCreatedCallbacks` below), NOT in
  // Zustand state — functions don't survive `persist()` round-trips and
  // would silently drop on rehydrate.
  onProjectCreated?: (projectId: string) => void;
}

// Module-scoped callback registry. Keyed by derived window id so the
// container can `consumeProjectCreatedCallback(windowId, newId)` from
// inside `handleSaved` without threading the callback through window
// metadata. Cleared on consume + on `closeWindow` to avoid leaks when
// the user dismisses the workspace before saving.
const projectCreatedCallbacks = new Map<string, (projectId: string) => void>();

/**
 * Invoked by `<ProjectWorkspaceContainer>` after a successful create.
 * Fires the callback (if any) registered for `windowId` with the new
 * project id, then deletes it. Idempotent: a second call is a no-op.
 */
export function consumeProjectCreatedCallback(
  windowId: string,
  projectId: string
): void {
  const cb = projectCreatedCallbacks.get(windowId);
  if (!cb) return;
  projectCreatedCallbacks.delete(windowId);
  cb(projectId);
}

interface OpenClientWindowOpts {
  clientId?: string | null;
  mode?: ClientWorkspaceMode;
  // Fired once with the freshly-created client id when the workspace body
  // finishes a creating→viewing save. Lets a parent surface react to the
  // create without subscribing to store internals. Module-scoped (see
  // `clientCreatedCallbacks`), never in Zustand state — functions don't
  // survive `persist()` round-trips.
  onClientCreated?: (clientId: string) => void;
}

// Client-workspace mirror of `projectCreatedCallbacks`. Keyed by derived
// window id; consumed + cleared by `<ClientWorkspaceContainer>` inside its
// `handleSaved`, and cleared on `closeWindow`.
const clientCreatedCallbacks = new Map<string, (clientId: string) => void>();

/**
 * Invoked by `<ClientWorkspaceContainer>` after a successful create. Fires
 * the registered callback (if any) for `windowId` with the new client id,
 * then deletes it. Idempotent.
 */
export function consumeClientCreatedCallback(
  windowId: string,
  clientId: string
): void {
  const cb = clientCreatedCallbacks.get(windowId);
  if (!cb) return;
  clientCreatedCallbacks.delete(windowId);
  cb(clientId);
}

interface WindowStoreState {
  windows: FloatingWindowState[];
  nextZIndex: number;
  openWindow: (opts: {
    id: string;
    title: string;
    type: FloatingWindowType;
    metadata?: Record<string, unknown>;
  }) => void;
  // Centralises id derivation + meta packaging so callers (FAB, project
  // canvas, spreadsheet, deep-link handler, dashboard widgets) all open
  // the same window for the same project — a second click focuses it.
  openProjectWindow: (opts: OpenProjectWindowOpts) => void;
  // Client-workspace mirror of openProjectWindow (WEB OVERHAUL P3.3) —
  // centralises id derivation + meta packaging so the FAB, the clients
  // list, widgets, the command palette, and the deep-link handler all open
  // the same window for the same client (second click focuses it).
  openClientWindow: (opts: OpenClientWindowOpts) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updatePosition: (id: string, position: { x: number; y: number }) => void;
  // Replaces the workspace `meta` for an existing window. Used by the
  // project + client workspace containers after a successful create — the
  // new id has to overwrite the `null` sentinel so subsequent re-opens
  // (deep-link, dock-restore, FAB) hit the right window.
  updateWindowMeta: (id: string, meta: WorkspaceWindowMeta) => void;
}

const DEFAULT_SIZE = { width: 560, height: 600 };

const SIZE_BY_TYPE: Partial<
  Record<FloatingWindowType, { width: number; height: number }>
> = {
  "create-estimate": { width: 780, height: 700 },
  "compose-email": { width: 620, height: 680 },
  "pipeline-detail": { width: 780, height: 680 },
  // Project workspace ships at 1080×760 — wide enough for the schedule
  // strip + sidebar at default zoom; tall enough for ~6 timeline rows
  // before the body needs to scroll. Min size 780×600 (Phase 6.10).
  "project-workspace": { width: 1080, height: 760 },
  // Client workspace is the tabbed dossier (Direction B) — no map hero or
  // schedule strip, so it ships narrower than the project window. 880×620
  // fits the CONTACT tab single-scroll with room for the tab strip; clears
  // the shell's 780×600 hard minimum.
  "client-workspace": { width: 880, height: 620 },
};

function getSizeForType(type: FloatingWindowType) {
  return SIZE_BY_TYPE[type] ?? DEFAULT_SIZE;
}

function getDefaultPosition(
  existingCount: number,
  size = DEFAULT_SIZE
): { x: number; y: number } {
  const offset = existingCount * 30;
  return {
    x: Math.max(
      20,
      Math.min(200 + offset, window.innerWidth - size.width - 40)
    ),
    y: Math.max(
      20,
      Math.min(100 + offset, window.innerHeight - size.height - 40)
    ),
  };
}

function deriveProjectWindowId(projectId: string | null): string {
  return `project-workspace:${projectId ?? "new"}`;
}

function deriveClientWindowId(clientId: string | null): string {
  return `client-workspace:${clientId ?? "new"}`;
}

export const useWindowStore = create<WindowStoreState>()((set, get) => ({
  windows: [],
  nextZIndex: 2000,

  openWindow: ({ id, title, type, metadata }) => {
    const { windows, nextZIndex } = get();
    const existing = windows.find((w) => w.id === id);
    if (existing) {
      // Restore + focus if already exists
      set({
        windows: windows.map((w) =>
          w.id === id
            ? {
                ...w,
                isMinimized: false,
                zIndex: nextZIndex,
                ...(metadata ? { metadata } : {}),
              }
            : w
        ),
        nextZIndex: nextZIndex + 1,
      });
      return;
    }

    const size = getSizeForType(type);
    const position = getDefaultPosition(
      windows.filter((w) => !w.isMinimized).length,
      size
    );
    set({
      windows: [
        ...windows,
        {
          id,
          title,
          type,
          isMinimized: false,
          position,
          size,
          zIndex: nextZIndex,
          metadata,
        },
      ],
      nextZIndex: nextZIndex + 1,
    });
  },

  openProjectWindow: ({
    projectId = null,
    mode,
    initialClientId = null,
    onProjectCreated,
  }) => {
    const initialMode: ProjectWorkspaceMode =
      mode ?? (projectId ? "viewing" : "creating");
    const id = deriveProjectWindowId(projectId);
    // Built once so the fresh-open and refocus paths carry an identical
    // meta — including the client seed, which must replace (never outlive)
    // the previous seed when the singleton creating window is re-targeted.
    const meta: ProjectWorkspaceWindowMeta = {
      projectId,
      initialMode,
      initialClientId,
    };
    // Register before any state mutation so the container — which reads
    // the callback inside `handleSaved` — never sees a window without
    // its callback wired. Re-register on a refocus too: callers that
    // re-open a creating-mode window can opt into a fresh callback.
    if (onProjectCreated) {
      projectCreatedCallbacks.set(id, onProjectCreated);
    }
    const { windows, nextZIndex } = get();
    const existing = windows.find((w) => w.id === id);
    // Title is intentionally short here — the workspace title bar overrides
    // it with the live `// PROJECT — JX-####` crumb once the body mounts.
    const title = projectId ? "Project Workspace" : "New Project";
    if (existing) {
      // Same project, second click — refocus and let the meta carry the
      // (possibly different) mode through to the body composer.
      set({
        windows: windows.map((w) =>
          w.id === id
            ? { ...w, isMinimized: false, zIndex: nextZIndex, meta }
            : w
        ),
        nextZIndex: nextZIndex + 1,
      });
      return;
    }
    const size = getSizeForType("project-workspace");
    const position = getDefaultPosition(
      windows.filter((w) => !w.isMinimized).length,
      size
    );
    set({
      windows: [
        ...windows,
        {
          id,
          title,
          type: "project-workspace",
          isMinimized: false,
          position,
          size,
          zIndex: nextZIndex,
          meta,
        },
      ],
      nextZIndex: nextZIndex + 1,
    });
  },

  openClientWindow: ({ clientId = null, mode, onClientCreated }) => {
    const initialMode: ClientWorkspaceMode =
      mode ?? (clientId ? "viewing" : "creating");
    const id = deriveClientWindowId(clientId);
    const meta: ClientWorkspaceWindowMeta = { clientId, initialMode };
    if (onClientCreated) {
      clientCreatedCallbacks.set(id, onClientCreated);
    }
    const { windows, nextZIndex } = get();
    const existing = windows.find((w) => w.id === id);
    // Title is a fallback only — the workspace title bar overrides it with
    // the live `// CLIENT — NAME` crumb once the body mounts.
    const title = clientId ? "Client Workspace" : "New Client";
    if (existing) {
      set({
        windows: windows.map((w) =>
          w.id === id
            ? { ...w, isMinimized: false, zIndex: nextZIndex, meta }
            : w
        ),
        nextZIndex: nextZIndex + 1,
      });
      return;
    }
    const size = getSizeForType("client-workspace");
    const position = getDefaultPosition(
      windows.filter((w) => !w.isMinimized).length,
      size
    );
    set({
      windows: [
        ...windows,
        {
          id,
          title,
          type: "client-workspace",
          isMinimized: false,
          position,
          size,
          zIndex: nextZIndex,
          meta,
        },
      ],
      nextZIndex: nextZIndex + 1,
    });
  },

  closeWindow: (id) => {
    // Clear any pending onCreated registration for this window — the user
    // dismissed the workspace before saving, so the parent surface (e.g.
    // the task modal) should not be invoked retroactively.
    projectCreatedCallbacks.delete(id);
    clientCreatedCallbacks.delete(id);
    set({ windows: get().windows.filter((w) => w.id !== id) });
  },

  minimizeWindow: (id) => {
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, isMinimized: true } : w
      ),
    });
  },

  restoreWindow: (id) => {
    const { windows, nextZIndex } = get();
    set({
      windows: windows.map((w) =>
        w.id === id ? { ...w, isMinimized: false, zIndex: nextZIndex } : w
      ),
      nextZIndex: nextZIndex + 1,
    });
  },

  focusWindow: (id) => {
    const { windows, nextZIndex } = get();
    set({
      windows: windows.map((w) =>
        w.id === id ? { ...w, zIndex: nextZIndex } : w
      ),
      nextZIndex: nextZIndex + 1,
    });
  },

  updatePosition: (id, position) => {
    set({
      windows: get().windows.map((w) => (w.id === id ? { ...w, position } : w)),
    });
  },

  updateWindowMeta: (id, meta) => {
    const { windows } = get();
    if (!windows.some((w) => w.id === id)) return;
    set({
      windows: windows.map((w) => (w.id === id ? { ...w, meta } : w)),
    });
  },
}));
