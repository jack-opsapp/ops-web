"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { PortalStatusBadge } from "./portal-status-badge";
import type { PortalProject } from "@/lib/types/portal";

interface PortalProjectCardProps {
  project: PortalProject;
  /** When true, renders as a wider featured card (single project) */
  featured?: boolean;
}

export function PortalProjectCard({ project, featured }: PortalProjectCardProps) {
  const thumbnail = project.projectImages?.[0];
  const progressPct = project.taskTotal > 0
    ? Math.round((project.taskCompleted / project.taskTotal) * 100)
    : 0;

  return (
    <Link href={`/portal/projects/${project.id}`} className={featured ? "col-span-full" : undefined}>
      <div
        className="overflow-hidden transition-colors cursor-pointer"
        style={{
          backgroundColor: "var(--portal-card)",
          boxShadow: "var(--portal-card-shadow)",
          border: "var(--portal-card-border)",
          borderRadius: "var(--portal-radius)",
          // Accent edge
          borderLeft: "var(--portal-card-accent-edge)" === "left"
            ? `var(--portal-card-accent-edge-width) solid var(--portal-accent)`
            : undefined,
          borderTop: "var(--portal-card-accent-edge)" === "top"
            ? `var(--portal-card-accent-edge-width) solid var(--portal-accent)`
            : undefined,
        }}
      >
        {/* Hero image */}
        {thumbnail ? (
          <div className={featured ? "h-48" : "h-36"} style={{ overflow: "hidden" }}>
            <img
              src={thumbnail}
              alt={project.title}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div
            className={featured ? "h-48" : "h-36"}
            style={{
              background: `linear-gradient(135deg, var(--portal-accent) 0%, var(--portal-bg-secondary) 100%)`,
              opacity: 0.3,
            }}
          />
        )}

        {/* Content */}
        <div style={{ padding: "var(--portal-card-padding, 20px)" }}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3
              className="text-base line-clamp-1"
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
                textTransform: "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
                letterSpacing: "var(--portal-letter-spacing)",
              }}
            >
              {project.title}
            </h3>
            <PortalStatusBadge status={project.status} />
          </div>

          {project.address && (
            <p
              className="flex items-center gap-1.5 text-sm mb-3"
              style={{ color: "var(--portal-text-secondary)" }}
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="line-clamp-1">{project.address}</span>
            </p>
          )}

          {/* Progress bar */}
          {project.taskTotal > 0 && (
            <div>
              <div
                className="w-full overflow-hidden"
                style={{
                  height: "var(--portal-progress-height, 4px)",
                  borderRadius: "var(--portal-progress-radius, 9999px)",
                  backgroundColor: "var(--portal-border)",
                }}
              >
                <div
                  style={{
                    width: `${progressPct}%`,
                    height: "100%",
                    backgroundColor: "var(--portal-accent)",
                    borderRadius: "var(--portal-progress-radius, 9999px)",
                    transition: "width 0.3s ease-out",
                  }}
                />
              </div>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--portal-text-tertiary)" }}
              >
                {progressPct}% complete
              </p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
