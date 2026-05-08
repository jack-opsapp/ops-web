"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { useWindowStore } from "@/stores/window-store";
import { WindowTitleBar } from "./window-title-bar";
import { ModeFooter, type ModeFooterConfig } from "./mode-footer";
import { ModalTabs, type ModalTab } from "./modal-tabs";
import { ResizeHandle } from "./resize-handle";
import { useWindowDrag } from "./use-window-drag";
import { useWindowResize, type ResizeDirection } from "./use-window-resize";
import { useWindowPersistence } from "./use-window-persistence";
import type { WorkspaceMode } from "./mode-pill";
import type { ChipVariant } from "@/components/ops/projects/workspace/atoms/chip";

// `ProjectWorkspaceWindow` — top-level shell that composes everything
// in Phase 6. Owns live position+size in local state (initialised from
// props + localStorage), drives drag/resize via the dedicated hooks,
// persists via useWindowPersistence, and brings the window to the
// front on any pointer-down inside the shell.
//
// The body slot is intentionally bare — Phase 7 (viewing) and Phase 8
// (edit/create) compose `<ProjectViewingBody>` and
// `<ProjectEditCreateBody>` inside it.

const ALL_RESIZE_DIRS: ResizeDirection[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// Workspace-specific min size — the sidebar (Phase 7) needs room, so
// the workspace bumps the global default 480x360 minimum to 780x600.
const WORKSPACE_MIN_SIZE = { width: 780, height: 600 };

export interface ProjectWorkspaceWindowProps<TTabId extends string = string> {
  /** Window id from useWindowStore — also the localStorage key. */
  id: string;
  /** Cake-rendered display title. */
  title: string;
  /** Optional Mono subtitle below the title. */
  subtitle?: string;
  /** Crumb label after the `//` prefix. */
  crumbLabel: string;
  /** Project / entity id label. */
  projectIdLabel: string;
  /** Status chip label. */
  statusLabel: string;
  /** Status chip tone. */
  statusTone?: ChipVariant;
  /** Active workspace mode. */
  mode: WorkspaceMode;
  /** Optional element rendered in the title bar's right slot. */
  headerAction?: React.ReactNode;
  /** Optional tabs — when present, ModalTabs renders below the title bar. */
  tabs?: ReadonlyArray<ModalTab<TTabId>>;
  activeTabId?: TTabId;
  onTabChange?: (id: TTabId) => void;
  /** Initial position from the store (live position is owned locally). */
  position: { x: number; y: number };
  /** Initial size from the store (live size is owned locally). */
  size: { width: number; height: number };
  /** z-index from the store — applied to the shell's inline style. */
  zIndex: number;
  /** Mode-aware footer config. */
  footerConfig: ModeFooterConfig;
  /** Optional right rail (always-on sidebar in viewing mode). */
  rightRail?: React.ReactNode;
  /** Body content — Phase 7/8 compose the actual viewing / edit body. */
  children: React.ReactNode;
  className?: string;
}

export function ProjectWorkspaceWindow<TTabId extends string = string>({
  id,
  title,
  subtitle,
  crumbLabel,
  projectIdLabel,
  statusLabel,
  statusTone,
  mode,
  headerAction,
  tabs,
  activeTabId,
  onTabChange,
  position: initialPosition,
  size: initialSize,
  zIndex,
  footerConfig,
  rightRail,
  children,
  className,
}: ProjectWorkspaceWindowProps<TTabId>) {
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const focusWindow = useWindowStore((s) => s.focusWindow);

  // Live position + size — the drag/resize hooks mutate these locally
  // for 60fps frames, then the store gets the final value via the
  // updatePosition path (Phase 9 wires that). Persistence rides on the
  // local state directly so dragging persists without round-tripping
  // the store.
  const [livePosition, setLivePosition] = React.useState(initialPosition);
  const [liveSize, setLiveSize] = React.useState(initialSize);

  // Hydrate from localStorage on first mount. We want the loaded snapshot
  // to override the props once, but not reset every time the parent
  // re-renders — useState initialiser would also be wrong because it
  // can't read the persistence hook's loaded value. A useEffect with
  // an empty-ish dep array does the job.
  const persistence = useWindowPersistence({ key: id, position: livePosition, size: liveSize });
  const hasHydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    if (persistence.loaded) {
      setLivePosition(persistence.loaded.position);
      setLiveSize(persistence.loaded.size);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drag = useWindowDrag({
    position: livePosition,
    onChange: setLivePosition,
  });

  const resize = useWindowResize({
    position: livePosition,
    size: liveSize,
    minSize: WORKSPACE_MIN_SIZE,
    onChange: ({ position, size }) => {
      setLivePosition(position);
      setLiveSize(size);
    },
  });

  // Click-to-front. We listen on the wrapper's pointer-down (capture
  // disabled — we don't want to swallow children events). Bringing the
  // window to the front is idempotent and cheap.
  const handleShellPointerDown = React.useCallback(() => {
    focusWindow(id);
  }, [focusWindow, id]);

  const handleClose = React.useCallback(() => closeWindow(id), [closeWindow, id]);
  const handleMinimize = React.useCallback(
    () => minimizeWindow(id),
    [minimizeWindow, id],
  );
  // Maximize is wired in Phase 12 (animation arc). For now it's a no-op
  // hook so the traffic-light still renders the cursor + glyph reveal.
  const handleMaximize = React.useCallback(() => {}, []);

  return (
    <div
      data-testid="project-workspace-window"
      onPointerDown={handleShellPointerDown}
      style={{
        left: livePosition.x,
        top: livePosition.y,
        width: liveSize.width,
        height: liveSize.height,
        zIndex,
        // 0 24px 64px primary shadow + 0.5px hairline for the matte
        // outline that separates dense glass from the canvas. Inline
        // because Tailwind named shadows don't include this exact stack.
        boxShadow:
          "0 24px 64px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,255,255,0.04)",
      }}
      className={cn(
        "fixed flex flex-col overflow-hidden",
        "glass-dense rounded-modal",
        // While dragging or resizing, kill text-selection so the cursor
        // stays committed to the action.
        (drag.isDragging || resize.isResizing) && "select-none",
        className,
      )}
    >
      <WindowTitleBar
        title={title}
        subtitle={subtitle}
        crumbLabel={crumbLabel}
        projectIdLabel={projectIdLabel}
        statusLabel={statusLabel}
        statusTone={statusTone}
        mode={mode}
        headerAction={headerAction}
        onClose={handleClose}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onPointerDown={drag.onPointerDown}
      />

      {tabs && activeTabId && onTabChange ? (
        <ModalTabs<TTabId>
          tabs={tabs}
          activeId={activeTabId}
          onChange={onTabChange}
        />
      ) : null}

      {/* Body + optional right rail share a single horizontal lane so the
          rail sits flush against the right edge while the body scrolls
          independently. min-h-0 so the flex children can shrink below
          their content size and let the body scroll. */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
        {rightRail ? (
          <div className="shrink-0 border-l border-glass-border overflow-y-auto">
            {rightRail}
          </div>
        ) : null}
      </div>

      <ModeFooter config={footerConfig} />

      {/* 8 resize handles — absolute-positioned over the shell border.
          Corners win in overlap regions via z-index inside ResizeHandle. */}
      {ALL_RESIZE_DIRS.map((dir) => (
        <ResizeHandle key={dir} direction={dir} onPointerDown={resize.beginResize} />
      ))}
    </div>
  );
}
