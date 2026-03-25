"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { PortalStatusBadge } from "./portal-status-badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectOption {
  id: string;
  title: string;
  status: string;
}

interface PortalProjectSwitcherProps {
  currentProjectId: string;
  projects: ProjectOption[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PortalProjectSwitcher({
  currentProjectId,
  projects,
}: PortalProjectSwitcherProps) {
  const { t } = useDictionary("portal");
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Don't render if fewer than 2 projects
  if (projects.length < 2) return null;

  const currentProject = projects.find((p) => p.id === currentProjectId);
  const otherProjects = projects.filter((p) => p.id !== currentProjectId);

  function handleSelect(projectId: string) {
    setIsOpen(false);
    if (projectId !== currentProjectId) {
      router.push(`/portal/projects/${projectId}`);
    }
  }

  // Close dropdown when clicking outside
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors"
        style={{
          backgroundColor: "var(--portal-bg-secondary, rgba(0,0,0,0.05))",
          border: "1px solid var(--portal-border)",
          borderRadius: "var(--portal-radius-sm)",
          color: "var(--portal-text-secondary)",
        }}
      >
        <span className="truncate max-w-[200px]">
          {t("project.switchProject")}
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 shrink-0 transition-transform"
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 w-72 max-h-[300px] overflow-y-auto z-[1000] rounded-lg shadow-lg"
          style={{
            backgroundColor: "var(--portal-card)",
            border: "1px solid var(--portal-border)",
            borderRadius: "var(--portal-radius)",
          }}
        >
          {/* Current project (highlighted) */}
          {currentProject && (
            <div
              className="px-3 py-2.5"
              style={{
                backgroundColor: "color-mix(in srgb, var(--portal-accent) 8%, transparent)",
                borderBottom: "1px solid var(--portal-border)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--portal-text)" }}
                >
                  {currentProject.title}
                </span>
                <PortalStatusBadge status={currentProject.status} />
              </div>
            </div>
          )}

          {/* Other projects */}
          {otherProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => handleSelect(project.id)}
              className="w-full text-left px-3 py-2.5 transition-colors"
              style={{
                borderBottom: "1px solid var(--portal-border)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "color-mix(in srgb, var(--portal-accent) 5%, transparent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-sm truncate"
                  style={{ color: "var(--portal-text)" }}
                >
                  {project.title}
                </span>
                <PortalStatusBadge status={project.status} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
