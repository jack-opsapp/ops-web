"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDetailPopoverStore } from "@/app/(dashboard)/pipeline/_components/detail-popover-store";
import { useWindowStore } from "@/stores/window-store";
import { useClientDetailPopoverStore } from "@/stores/client-detail-popover-store";
import { useInvoiceDetailPopoverStore } from "@/stores/invoice-detail-popover-store";
import { useEstimateDetailPopoverStore } from "@/stores/estimate-detail-popover-store";
import { WT } from "@/lib/widget-tokens";

// ── Types ────────────────────────────────────────────────────────────

type EntityType = "project" | "opportunity" | "client" | "invoice" | "estimate" | "task";

interface OpenEntityOptions {
  entityType: EntityType;
  entityId: string;
  title: string;
  /** Color for the popover dock pill (defaults to WT.accent) */
  color?: string;
  /** Mouse event for positioning the popover near the click */
  event?: React.MouseEvent;
  /** Fallback URL if no popover exists for this entity type */
  fallbackPath?: string;
  /** For task entities: the parent project ID to open the project popover */
  parentProjectId?: string;
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Opens entity detail popovers from widget line items.
 * Supports all entity types via their respective popover stores.
 */
export function useWidgetEntityOpen() {
  const router = useRouter();
  const openPipelinePopover = useDetailPopoverStore((s) => s.openPopover);
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);
  const openClientPopover = useClientDetailPopoverStore((s) => s.openPopover);
  const openInvoicePopover = useInvoiceDetailPopoverStore((s) => s.openPopover);
  const openEstimatePopover = useEstimateDetailPopoverStore((s) => s.openPopover);

  const openEntity = useCallback(
    (opts: OpenEntityOptions) => {
      const { entityType, entityId, title, color, event, fallbackPath, parentProjectId } = opts;

      // Compute screen position from click event, or center of viewport
      const screenPos = event
        ? { x: event.clientX + 20, y: Math.max(event.clientY - 100, 40) }
        : { x: Math.round(globalThis.innerWidth / 2 - 220), y: 100 };

      switch (entityType) {
        case "opportunity":
          openPipelinePopover(entityId, screenPos, title, color ?? WT.accent);
          return;

        case "project":
          // Phase 9.6 — projects open in the unified workspace window.
          // Position/title/color are no longer relevant: the workspace
          // owns its own chrome and derives them from the project.
          openProjectWindow({ projectId: entityId, mode: "viewing" });
          return;

        case "client":
          openClientPopover(entityId, screenPos, title, color ?? WT.accent);
          return;

        case "invoice":
          openInvoicePopover(entityId, screenPos, title, color ?? WT.accent);
          return;

        case "estimate":
          openEstimatePopover(entityId, screenPos, title, color ?? WT.accent);
          return;

        case "task":
          // Tasks live inside a project — open the parent project's
          // workspace. Falls back to the projects list when no parent
          // is supplied.
          if (parentProjectId) {
            openProjectWindow({ projectId: parentProjectId, mode: "viewing" });
          } else {
            const path = fallbackPath ?? `/projects`;
            router.push(path);
          }
          return;

        default: {
          const path = fallbackPath ?? `/${entityType}s/${entityId}`;
          router.push(path);
          return;
        }
      }
    },
    [router, openPipelinePopover, openProjectWindow, openClientPopover, openInvoicePopover, openEstimatePopover]
  );

  return openEntity;
}
