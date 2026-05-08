"use client";

import * as React from "react";
import { MapPinOff } from "lucide-react";
import { useProject } from "@/lib/hooks/use-projects";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { MapHero } from "@/components/ops/projects/workspace/map/map-hero";
import { ScheduleStrip } from "./schedule-strip";
import {
  ProjectViewingTabs,
  type ViewingTabId,
} from "./project-viewing-tabs";
import { ActivityTab } from "./activity-tab";
import { DetailsTab } from "./details-tab";
import { AccountingTab } from "./accounting-tab";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { cn } from "@/lib/utils/cn";

// `ProjectViewingBody` — orchestrator for the workspace viewing surface.
// Layout (top → bottom):
//
//   ┌─────────────────────────────────────────────┐
//   │ MapHero (compact 220px, expandable)         │
//   ├─────────────────────────────────────────────┤
//   │ ScheduleStrip                               │
//   ├─────────────────────────────────────────────┤
//   │ ProjectViewingTabs (Activity·Details·…)     │
//   ├─────────────────────────────────────────────┤
//   │ ActiveTabBody (scrolling)                   │
//   └─────────────────────────────────────────────┘
//
// The right-side sidebar is composed *outside* this body — passed into
// `ProjectWorkspaceWindow.rightRail` by the parent. This component fills
// only the left column.
//
// MapHero expansion is local state. When expanded, the Map fills the body
// and the rest of the body collapses. ScheduleStrip + Tabs + tab body are
// hidden while expanded — the user is in "where is this" mode, not "what
// has happened" mode.
//
// Permission gating:
//   - Accounting tab disabled when both `invoices.view` and `estimates.view`
//     are denied. (Plan §Phase 7.7)
//   - When the current tab becomes disabled mid-session, fall back to
//     details (the always-allowed safety net).

interface ProjectViewingBodyProps {
  projectId: string;
  className?: string;
}

const TAB_ORDER: ReadonlyArray<{ id: ViewingTabId; label: string }> = [
  { id: "activity", label: "ACTIVITY" },
  { id: "details", label: "DETAILS" },
  { id: "accounting", label: "ACCOUNTING" },
];

function MapPlaceholder() {
  return (
    <div
      data-testid="map-placeholder"
      className="flex h-[220px] w-full items-center justify-center border-b border-glass-border"
      style={{ background: "var(--scrim-overlay)" }}
    >
      <span className="inline-flex items-center gap-2 text-text-3">
        <MapPinOff className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        <Mono color="text-3" size={9}>
          NO COORDINATES SET
        </Mono>
      </span>
    </div>
  );
}

export function ProjectViewingBody({ projectId, className }: ProjectViewingBodyProps) {
  const { data: project, isLoading } = useProject(projectId);
  const can = usePermissionStore((s) => s.can);
  const canViewFinancials = can("invoices.view") || can("estimates.view");

  const [mapExpanded, setMapExpanded] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<ViewingTabId>("activity");

  // If the current tab is the financial one and permission is revoked
  // mid-session, fall back to Details — the always-allowed default.
  React.useEffect(() => {
    if (activeTab === "accounting" && !canViewFinancials) {
      setActiveTab("details");
    }
  }, [activeTab, canViewFinancials]);

  if (isLoading || !project) {
    return (
      <div
        data-testid="project-viewing-body-loading"
        className={cn("flex h-full items-center justify-center", className)}
      >
        <Body size={14} color="text-3">
          Loading…
        </Body>
      </div>
    );
  }

  const status = project.status;
  const statusColor = PROJECT_STATUS_COLORS[status];
  const statusLabel = status.toUpperCase();
  const projectIdLabel = project.id.slice(0, 8).toUpperCase();
  const hasCoords = project.latitude != null && project.longitude != null;

  const tabs = TAB_ORDER.map((t) => ({
    id: t.id,
    label: t.label,
    disabled: t.id === "accounting" && !canViewFinancials,
  }));

  return (
    <div
      data-testid="project-viewing-body"
      data-map-expanded={String(mapExpanded)}
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      {/* Map area — when expanded, takes the whole body. The flex-1 path
          is intentionally only for the expanded state; collapsed state has
          a fixed 220px height set by MapHero itself. */}
      <div
        className={cn(
          "shrink-0",
          mapExpanded && "flex-1 min-h-0",
        )}
      >
        {hasCoords ? (
          <MapHero
            latitude={project.latitude!}
            longitude={project.longitude!}
            address={project.address ?? "—"}
            statusColor={statusColor}
            statusLabel={statusLabel}
            projectId={projectIdLabel}
            projectName={project.title}
            expanded={mapExpanded}
            onToggleExpand={() => setMapExpanded((v) => !v)}
          />
        ) : (
          <MapPlaceholder />
        )}
      </div>

      {/* Schedule + tabs + body — collapse out while the map is expanded. */}
      {!mapExpanded && (
        <>
          <ScheduleStrip
            startDate={project.startDate ?? null}
            endDate={project.endDate ?? null}
            status={status}
          />
          <ProjectViewingTabs
            tabs={tabs}
            activeId={activeTab}
            onChange={setActiveTab}
          />
          <div
            data-testid={`viewing-body-${activeTab}`}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {activeTab === "activity" && <ActivityTab projectId={projectId} />}
            {activeTab === "details" && <DetailsTab projectId={projectId} />}
            {activeTab === "accounting" && canViewFinancials && (
              <AccountingTab projectId={projectId} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// `ProjectViewingBody` is the left-column fill. The workspace shell composes
// `<ProjectWorkspaceWindow rightRail={<ProjectSidebar />} />` so the sidebar
// stays always-on regardless of which tab is active. Re-exporting from this
// module so callers don't need a second import.
export { ProjectSidebar } from "./project-sidebar";
