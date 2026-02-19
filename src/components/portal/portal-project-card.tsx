"use client";

import Link from "next/link";
import { MapPin, Calendar, Image as ImageIcon } from "lucide-react";
import { PortalStatusBadge } from "./portal-status-badge";
import type { PortalProject } from "@/lib/types/portal";

interface PortalProjectCardProps {
  project: PortalProject;
}

function formatDate(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PortalProjectCard({ project }: PortalProjectCardProps) {
  const thumbnail = project.projectImages?.[0];

  return (
    <Link href={`/portal/projects/${project.id}`}>
      <div
        className="rounded-xl overflow-hidden transition-colors cursor-pointer"
        style={{
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
        }}
      >
        {/* Thumbnail */}
        {thumbnail ? (
          <div className="h-36 overflow-hidden">
            <img
              src={thumbnail}
              alt={project.title}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div
            className="h-36 flex items-center justify-center"
            style={{ backgroundColor: "var(--portal-bg-secondary)" }}
          >
            <ImageIcon className="w-8 h-8" style={{ color: "var(--portal-text-tertiary)" }} />
          </div>
        )}

        {/* Content */}
        <div style={{ padding: "var(--portal-card-padding, 20px)" }}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3
              className="text-base font-semibold line-clamp-1"
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
              }}
            >
              {project.title}
            </h3>
            <PortalStatusBadge status={project.status} />
          </div>

          {project.address && (
            <p
              className="flex items-center gap-1.5 text-sm mb-2"
              style={{ color: "var(--portal-text-secondary)" }}
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="line-clamp-1">{project.address}</span>
            </p>
          )}

          {(project.startDate || project.endDate) && (
            <p
              className="flex items-center gap-1.5 text-sm"
              style={{ color: "var(--portal-text-tertiary)" }}
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>
                {formatDate(project.startDate)}
                {project.endDate && ` — ${formatDate(project.endDate)}`}
              </span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
