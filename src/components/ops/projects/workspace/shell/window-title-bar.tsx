"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Cake } from "@/components/ops/projects/workspace/atoms/cake";
import { Chip, type ChipVariant } from "@/components/ops/projects/workspace/atoms/chip";
import { TrafficLight } from "./traffic-light";
import { ModePill, type WorkspaceMode } from "./mode-pill";

// `WindowTitleBar` — workspace title bar. The drag origin for the whole
// window: pointer-down on the surface (anywhere except `[data-no-drag]`)
// kicks off a window drag. User-select is disabled across the bar so a
// stray click-and-drag never paints a selection rectangle.
//
// Top row (left → right):
//   1. Traffic-light cluster (close / minimize / maximize)
//   2. Vertical separator (1px, white-alpha)
//   3. // CRUMB · ID · status chip · mode pill
//   4. Flexible spacer
//   5. Optional headerAction slot (e.g. share / archive)
// Below the row sit the Cake title and the Mono subtitle.

export interface WindowTitleBarProps {
  /** Cake-rendered display title, e.g. project name. */
  title: string;
  /** Optional Mono subtitle below the title (e.g. address line). */
  subtitle?: string;
  /** Crumb label after the `//` prefix — typically "PROJECT". */
  crumbLabel: string;
  /** Project / entity id label, e.g. "JX-4821". */
  projectIdLabel: string;
  /** Status chip label, e.g. "ACCEPTED". */
  statusLabel: string;
  /** Status chip tone — uses Chip atom variants. */
  statusTone?: ChipVariant;
  /** Active workspace mode driving the ModePill. */
  mode: WorkspaceMode;
  /** Optional element rendered to the right (e.g. Edit button). */
  headerAction?: React.ReactNode;
  /** Window controls — wired by the shell to useWindowStore. */
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  /**
   * Pointer-down on the bar surface — kicks off the window drag. The
   * shell's `useWindowDrag` hook owns the actual pointer-move tracking;
   * the title bar is just the affordance.
   */
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  className?: string;
}

export function WindowTitleBar({
  title,
  subtitle,
  crumbLabel,
  projectIdLabel,
  statusLabel,
  statusTone = "neutral",
  mode,
  headerAction,
  onClose,
  onMinimize,
  onMaximize,
  onPointerDown,
  className,
}: WindowTitleBarProps) {
  return (
    <div
      data-testid="workspace-title-bar"
      onPointerDown={onPointerDown}
      // Geometry from spec: 9px top / 14px sides / 10px bottom; bottom
      // hairline at 10% white alpha; subtle gradient drop so the bar
      // separates from the body.
      className={cn(
        "select-none cursor-grab",
        "px-[14px] pt-[9px] pb-[10px]",
        "border-b border-[var(--line)]",
        "bg-[linear-gradient(180deg,var(--surface-hover),transparent)]",
        className,
      )}
    >
      {/* Top row — controls, crumb, status, mode, spacer, header action */}
      <div className="flex items-center gap-[10px]">
        {/* Traffic-light cluster — `data-no-drag` so the drag hook
            short-circuits when pointer-down lands here. The cluster has
            its own gap; tightened slightly vs. macOS to fit the chrome. */}
        <div
          data-no-drag
          className="flex items-center gap-[8px]"
          // Stop pointer-down inside the cluster from reaching the bar
          // (drag-start). Click events still fire on the buttons.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <TrafficLight tone="close" onClick={onClose} />
          <TrafficLight tone="minimize" onClick={onMinimize} />
          <TrafficLight tone="maximize" onClick={onMaximize} />
        </div>

        {/* Vertical separator — same hairline tone as the bottom border. */}
        <span
          aria-hidden
          className="block w-px h-[14px] bg-[var(--line)]"
        />

        {/* Crumb — `// PROJECT · JX-4821` */}
        <div className="flex items-center gap-[8px] min-w-0">
          <Mono size={10} color="text-3" className="whitespace-nowrap">
            // {crumbLabel}
          </Mono>
          <Mono size={10} color="text-2" className="whitespace-nowrap">
            {projectIdLabel}
          </Mono>
          <Chip variant={statusTone} size="sm">
            {statusLabel}
          </Chip>
          <div data-no-drag onPointerDown={(e) => e.stopPropagation()}>
            <ModePill mode={mode} />
          </div>
        </div>

        {/* Flexible spacer */}
        <div className="flex-1" />

        {/* Header action slot — also data-no-drag so internal buttons
            don't initiate a window drag. */}
        {headerAction ? (
          <div
            data-no-drag
            className="flex items-center"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {headerAction}
          </div>
        ) : null}
      </div>

      {/* Title + subtitle row — sits below the controls row, indented to
          align with the crumb (past the traffic-light cluster). */}
      <div className="mt-[6px] pl-[78px]">
        <Cake size={18} className="block leading-[1.1] text-[20px]">
          {title}
        </Cake>
        {subtitle ? (
          <Mono size={10} color="text-3" caseSensitive className="block mt-[2px]">
            {subtitle}
          </Mono>
        ) : null}
      </div>
    </div>
  );
}
