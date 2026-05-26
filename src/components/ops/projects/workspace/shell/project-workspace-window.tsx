"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
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

const ALL_RESIZE_DIRS: ResizeDirection[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

// Workspace-specific min size — the sidebar (Phase 7) needs room, so
// the workspace bumps the global default 480x360 minimum to 780x600.
const WORKSPACE_MIN_SIZE = { width: 780, height: 600 };

// ─── Mode transition motion tokens (Phase 12.3) ─────────────────────────────
// Body cross-fade: AnimatePresence mode="wait" — outgoing fades to 0
// over 200ms before incoming fades in over 200ms. No overlap window, so
// pointer-events stay safe without explicit gating.
// Tab bar slot: when ModalTabs mounts (entering edit/create) it slides
// from y:-8 + opacity 0 → 0/1 over 200ms. Reverse on viewing return.
// Right rail mirrors the body fade so the sidebar dissolves on edit
// entry instead of vanishing in one frame.
const MODE_BODY_DURATION = 0.2;
const MODE_TAB_DURATION = 0.2;
const WINDOW_GLASS_FILL_CLASS =
  "bg-[var(--glass-bg-dense)] backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)]";
const WINDOW_GLASS_TOP_EDGE_CLASS =
  "before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_35%)]";

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
  /** Optional close override for workspace-shell consumers that own external state. */
  onRequestClose?: () => void;
  /** Optional keyboard scope marker for windows owned by shortcut-heavy canvases. */
  keyboardScope?: "modal-or-menu";
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
  onRequestClose,
  keyboardScope,
  children,
  className,
}: ProjectWorkspaceWindowProps<TTabId>) {
  const reducedMotion = useReducedMotion();
  const bodyTransition = reducedMotion
    ? { duration: 0 }
    : { duration: MODE_BODY_DURATION, ease: EASE_SMOOTH };
  const tabTransition = reducedMotion
    ? { duration: 0 }
    : { duration: MODE_TAB_DURATION, ease: EASE_SMOOTH };

  const closeWindow = useWindowStore((s) => s.closeWindow);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const [isMobile, setIsMobile] = React.useState(false);

  // Live position + size — the drag/resize hooks mutate these locally
  // for 60fps frames, then the store gets the final value via the
  // updatePosition path (Phase 9 wires that). Persistence rides on the
  // local state directly so dragging persists without round-tripping
  // the store.
  const [livePosition, setLivePosition] = React.useState(initialPosition);
  const [liveSize, setLiveSize] = React.useState(initialSize);

  React.useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mq = globalThis.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Hydrate from localStorage on first mount. We want the loaded snapshot
  // to override the props once, but not reset every time the parent
  // re-renders — useState initialiser would also be wrong because it
  // can't read the persistence hook's loaded value. A useEffect with
  // an empty-ish dep array does the job.
  const persistence = useWindowPersistence({
    key: id,
    position: livePosition,
    size: liveSize,
  });
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

  const handleClose = React.useCallback(() => {
    if (onRequestClose) {
      onRequestClose();
      return;
    }

    closeWindow(id);
  }, [closeWindow, id, onRequestClose]);
  const handleMinimize = React.useCallback(
    () => minimizeWindow(id),
    [minimizeWindow, id]
  );
  // Maximize is wired in Phase 12 (animation arc). For now it's a no-op
  // hook so the traffic-light still renders the cursor + glyph reveal.
  const handleMaximize = React.useCallback(() => {}, []);

  return (
    <div
      data-testid="project-workspace-window"
      data-keyboard-scope={keyboardScope}
      onPointerDown={handleShellPointerDown}
      style={{
        left: isMobile ? 8 : livePosition.x,
        top: isMobile ? 64 : livePosition.y,
        width: isMobile ? "calc(100vw - 16px)" : liveSize.width,
        height: isMobile ? "calc(100dvh - 72px)" : liveSize.height,
        zIndex,
        // --shadow-window: 0 24px 64px scrim + 0.5px hairline ring.
        // Sanctioned exception to spec line 268 ("no shadow on dark
        // backgrounds") — floating-window shells need separation from
        // canvas. See uploads/system.md amendment 2026-05-07.
        boxShadow: "var(--shadow-window)",
      }}
      className={cn(
        "fixed flex flex-col overflow-hidden",
        "rounded-modal border border-glass-border bg-transparent",
        // While dragging or resizing, kill text-selection so the cursor
        // stays committed to the action.
        (drag.isDragging || resize.isResizing) && "select-none",
        className
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
        className={cn(WINDOW_GLASS_FILL_CLASS, WINDOW_GLASS_TOP_EDGE_CLASS)}
      />

      {/* Tab strip slides in when entering edit/create, slides out when
          returning to viewing. AnimatePresence keeps the exit animation
          alive after the parent stops rendering ModalTabs. The body
          height snaps as the tabs appear/disappear — accepted concession
          per plan §12.3 (transform-only motion, no layout animation). */}
      <AnimatePresence initial={false}>
        {tabs && activeTabId !== undefined && onTabChange ? (
          <motion.div
            key="modal-tabs"
            data-testid="modal-tabs-wrapper"
            initial={reducedMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={tabTransition}
          >
            <ModalTabs<TTabId>
              tabs={tabs}
              activeId={activeTabId}
              onChange={onTabChange}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Body + optional right rail share a single horizontal lane so the
          rail sits flush against the right edge while the body scrolls
          independently. min-h-0 so the flex children can shrink below
          their content size and let the body scroll.

          Mode cross-fade (Phase 12.3): the body slot wraps in
          AnimatePresence mode="wait" keyed on `mode` so the outgoing body
          completes its 200ms exit before the incoming body mounts. No
          overlap window means pointer-events handling is implicit — the
          DOM only ever holds one body at a time.

          Right rail (sidebar) mirrors the same fade so the sidebar
          dissolves on edit entry rather than disappearing in one frame. */}
      <div
        data-testid="workspace-body-region"
        className="relative z-[1] flex min-h-0 flex-1 bg-transparent"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            data-testid="workspace-body-slot"
            data-mode={mode}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={bodyTransition}
            className={cn(
              "relative min-w-0 flex-1 overflow-y-auto",
              WINDOW_GLASS_FILL_CLASS,
              WINDOW_GLASS_TOP_EDGE_CLASS
            )}
          >
            {children}
          </motion.div>
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {rightRail ? (
            <motion.div
              key="right-rail"
              data-testid="workspace-right-rail-wrapper"
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0 }}
              transition={bodyTransition}
              className={cn(
                "relative hidden shrink-0 overflow-y-auto border-l border-glass-border md:block",
                WINDOW_GLASS_FILL_CLASS,
                WINDOW_GLASS_TOP_EDGE_CLASS
              )}
            >
              {rightRail}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <ModeFooter config={footerConfig} />

      {/* 8 resize handles — absolute-positioned over the shell border.
          Corners win in overlap regions via z-index inside ResizeHandle. */}
      {!isMobile &&
        ALL_RESIZE_DIRS.map((dir) => (
          <ResizeHandle
            key={dir}
            direction={dir}
            onPointerDown={resize.beginResize}
          />
        ))}
    </div>
  );
}
