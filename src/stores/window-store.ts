"use client";

import { create } from "zustand";

export type FloatingWindowType =
  | "create-project"
  | "create-client"
  | "create-task"
  | "create-estimate"
  | "create-lead"
  | "compose-email"
  | "project-workspace";

// Mode passed into the project workspace shell on open. The body composer
// re-reads this from `meta` on mount, then owns the live mode locally so
// the user can switch viewing → editing without re-opening the window.
export type ProjectWorkspaceMode = "viewing" | "editing" | "creating";

export interface ProjectWorkspaceWindowMeta {
  // null sentinels the create-new flow — the workspace renders the
  // edit/create body without prefilling from a Supabase row.
  projectId: string | null;
  initialMode: ProjectWorkspaceMode;
}

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
  /** Strongly-typed metadata for project-workspace windows. */
  meta?: ProjectWorkspaceWindowMeta;
}

interface OpenProjectWindowOpts {
  projectId?: string | null;
  mode?: ProjectWorkspaceMode;
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
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updatePosition: (id: string, position: { x: number; y: number }) => void;
}

const DEFAULT_SIZE = { width: 560, height: 600 };

const SIZE_BY_TYPE: Partial<Record<FloatingWindowType, { width: number; height: number }>> = {
  "create-estimate": { width: 780, height: 700 },
  "compose-email": { width: 620, height: 680 },
  // Project workspace ships at 1080×760 — wide enough for the schedule
  // strip + sidebar at default zoom; tall enough for ~6 timeline rows
  // before the body needs to scroll. Min size 780×600 (Phase 6.10).
  "project-workspace": { width: 1080, height: 760 },
};

function getSizeForType(type: FloatingWindowType) {
  return SIZE_BY_TYPE[type] ?? DEFAULT_SIZE;
}

function getDefaultPosition(existingCount: number, size = DEFAULT_SIZE): { x: number; y: number } {
  const offset = existingCount * 30;
  return {
    x: Math.max(20, Math.min(200 + offset, window.innerWidth - size.width - 40)),
    y: Math.max(20, Math.min(100 + offset, window.innerHeight - size.height - 40)),
  };
}

function deriveProjectWindowId(projectId: string | null): string {
  return `project-workspace:${projectId ?? "new"}`;
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
            ? { ...w, isMinimized: false, zIndex: nextZIndex, ...(metadata ? { metadata } : {}) }
            : w
        ),
        nextZIndex: nextZIndex + 1,
      });
      return;
    }

    const size = getSizeForType(type);
    const position = getDefaultPosition(windows.filter((w) => !w.isMinimized).length, size);
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

  openProjectWindow: ({ projectId = null, mode }) => {
    const initialMode: ProjectWorkspaceMode =
      mode ?? (projectId ? "viewing" : "creating");
    const id = deriveProjectWindowId(projectId);
    const meta: ProjectWorkspaceWindowMeta = { projectId, initialMode };
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

  closeWindow: (id) => {
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
        w.id === id
          ? { ...w, isMinimized: false, zIndex: nextZIndex }
          : w
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
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, position } : w
      ),
    });
  },
}));
