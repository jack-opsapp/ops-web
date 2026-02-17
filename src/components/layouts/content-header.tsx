"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";

const routeTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/calendar": "Calendar",
  "/clients": "Clients",
  "/job-board": "Job Board",
  "/team": "Team",
  "/map": "Map",
  "/pipeline": "Pipeline",
  "/invoices": "Invoices",
  "/accounting": "Accounting",
  "/settings": "Settings",
};

function getBreadcrumbs(pathname: string): { label: string; href?: string; isEntity?: boolean }[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href?: string; isEntity?: boolean }[] = [];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const title = routeTitles[currentPath];
    if (title) {
      crumbs.push({ label: title, href: currentPath });
    } else if (segment === "new") {
      crumbs.push({ label: "New" });
    } else if (segment.match(/^[a-zA-Z0-9_-]+$/)) {
      crumbs.push({ label: segment, isEntity: true });
    }
  }

  return crumbs;
}

function getPageTitle(pathname: string): string | null {
  for (const [route, title] of Object.entries(routeTitles)) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      return title;
    }
  }
  return null;
}

export function ContentHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const entityName = useBreadcrumbStore((s) => s.entityName);

  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);
  const pageTitle = useMemo(() => getPageTitle(pathname), [pathname]);

  if (breadcrumbs.length <= 1 && !pageTitle) return null;

  return (
    <div className="px-3 pt-2 pb-1 shrink-0">
      {breadcrumbs.length > 1 ? (
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
      ) : pageTitle ? (
        <h1 className="font-mohave text-heading text-text-primary uppercase tracking-wider truncate">
          {pageTitle}
        </h1>
      ) : null}
    </div>
  );
}
