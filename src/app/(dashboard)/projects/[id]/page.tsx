"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useProject } from "@/lib/hooks/use-projects";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { ProjectViewingBody } from "@/components/ops/projects/workspace/viewing/project-viewing-body";

// Phase 9.8 — full-page mode of the workspace viewing surface.
//
// Phases 1–8 of the workspace rebuild moved every interactive entry
// point (canvas, spreadsheet, widgets, deep-links) onto the floating
// project-workspace window. The legacy `/projects/<id>` route is kept
// alive for SEO and the iOS Smart App Banner; instead of the bespoke
// 1485-line tabs+modals page that lived here, the route now renders
// `<ProjectViewingBody>` directly with no window chrome and no inline
// edit modal. Edit lives only on the workspace window — the route's
// "Edit" affordance (when one is reintroduced post-Phase 10) deep-
// links to `/projects?openProject=<id>&mode=edit` so the dashboard
// layout's deep-link handler swings the window open.
//
// Phase 10 decides the route's final fate (keep / redirect / delete);
// 9.8 only rewires the body.

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const { currentUser } = useAuthStore();
  const can = usePermissionStore((s) => s.can);

  const { data: project, isLoading } = useProject(projectId || undefined);

  usePageTitle(project?.title ?? "Project");

  // Set breadcrumb entity name so the header shows the project name,
  // not the UUID.
  const setEntityName = useBreadcrumbStore((s) => s.setEntityName);
  const clearEntityName = useBreadcrumbStore((s) => s.clearEntityName);
  useEffect(() => {
    if (project?.title) setEntityName(project.title);
    return () => clearEntityName();
  }, [project?.title, setEntityName, clearEntityName]);

  // Scope enforcement: if the user has projects.view: assigned (not
  // all), deny access when this project isn't in their assigned list.
  // RLS already filters by company; this is the within-company scope
  // gate. Mirrors the gate previously enforced inline.
  const hasAllProjectsScope = can("projects.view", "all");
  const isAssignedToProject = useMemo(() => {
    if (!project || !currentUser) return false;
    return project.teamMemberIds?.includes(currentUser.id) ?? false;
  }, [project, currentUser]);
  const accessDenied = !!project && !hasAllProjectsScope && !isAssignedToProject;

  if (isLoading || !projectId) {
    return null;
  }

  if (accessDenied || !project) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] gap-3">
        <span className="font-mohave text-[64px] text-text-mute leading-none">
          404
        </span>
        <span className="font-mono text-caption-sm text-text-3 uppercase tracking-wider">
          Project not found
        </span>
        <button
          onClick={() => router.push("/projects")}
          className="font-mono text-[11px] text-text-3 uppercase tracking-wider hover:text-text-2 transition-colors cursor-pointer"
        >
          ← Back to projects
        </button>
      </div>
    );
  }

  // Render the workspace viewing body directly — no window chrome,
  // no tabs row above (the body owns its own tab strip), no edit
  // modal. The dashboard's deep-link handler is the only path back to
  // editing.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectViewingBody projectId={projectId} />
    </div>
  );
}
