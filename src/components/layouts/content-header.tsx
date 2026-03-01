"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { useDictionary } from "@/i18n/client";

const routeKeys: Record<string, string> = {
  "/dashboard": "route.dashboard",
  "/projects": "route.projects",
  "/calendar": "route.calendar",
  "/clients": "route.clients",
  "/job-board": "route.jobBoard",
  "/team": "route.team",
  "/map": "route.map",
  "/pipeline": "route.pipeline",
  "/invoices": "route.invoices",
  "/accounting": "route.accounting",
  "/settings": "route.settings",
};

function getBreadcrumbs(pathname: string, t: (key: string) => string): { label: string; href?: string; isEntity?: boolean }[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href?: string; isEntity?: boolean }[] = [];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const key = routeKeys[currentPath];
    if (key) {
      crumbs.push({ label: t(key), href: currentPath });
    } else if (segment === "new") {
      crumbs.push({ label: t("route.new") });
    } else if (segment.match(/^[a-zA-Z0-9_-]+$/)) {
      crumbs.push({ label: segment, isEntity: true });
    }
  }

  return crumbs;
}

export function ContentHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const entityName = useBreadcrumbStore((s) => s.entityName);
  const { t } = useDictionary("breadcrumbs");

  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname, t), [pathname, t]);

  // Only render breadcrumbs for nested routes (2+ segments).
  // Top-level pages handle their own headers with counts, actions, etc.
  if (breadcrumbs.length <= 1) return null;

  return (
    <div className="px-3 pt-2 pb-1 shrink-0">
      <div className="flex items-center gap-[6px]">
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          const displayLabel =
            crumb.isEntity && entityName
              ? entityName
              : crumb.isEntity
                ? crumb.label.length > 16
                  ? crumb.label.slice(0, 16) + "..."
                  : crumb.label
                : crumb.label;

          return (
            <div key={index} className="flex items-center gap-[6px]">
              {index > 0 && (
                <span className="text-text-disabled font-mono text-body-sm">/</span>
              )}
              {crumb.href && !isLast ? (
                <button
                  onClick={() => router.push(crumb.href!)}
                  className="font-mohave text-body-sm text-text-tertiary hover:text-text-secondary transition-colors truncate uppercase tracking-wider"
                >
                  {displayLabel}
                </button>
              ) : (
                <span className="font-mohave text-body font-semibold text-text-primary truncate uppercase tracking-wider">
                  {displayLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
