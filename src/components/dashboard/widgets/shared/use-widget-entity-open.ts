"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDetailPopoverStore } from "@/app/(dashboard)/pipeline/_components/detail-popover-store";
import { useProjectDetailPopoverStore } from "@/app/(dashboard)/projects/_components/project-detail-popover-store";
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
  const openProjectPopover = useProjectDetailPopoverStore((s) => s.openPopover);
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
          openProjectPopover(entityId, screenPos, title, color ?? WT.accent);
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
          // Open the parent project's popover — tasks live within project context
          if (parentProjectId) {
            openProjectPopover(parentProjectId, screenPos, title, color ?? WT.accent);
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
    [router, openPipelinePopover, openProjectPopover, openClientPopover, openInvoicePopover, openEstimatePopover]
  );

  return openEntity;
}
