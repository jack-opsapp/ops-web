import { Download } from "lucide-react";

import { OpsLockup } from "@/components/brand";

interface DevelopersHeaderCopy {
  readonly developers: string;
  readonly navigationLabel: string;
  readonly restApi: string;
  readonly mcp: string;
  readonly endpoint: string;
}

interface DevelopersHeaderAction {
  readonly href: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly download?: boolean;
}

interface DevelopersHeaderProps {
  readonly activeReference: "api" | "mcp";
  readonly copy: DevelopersHeaderCopy;
  readonly versionLabel: string;
  readonly endpoint: string;
  readonly action?: DevelopersHeaderAction;
}

const REFERENCES = [
  { id: "api", href: "/developers/api", copyKey: "restApi" },
  { id: "mcp", href: "/developers/mcp", copyKey: "mcp" },
] as const;

export function DevelopersHeader({
  activeReference,
  copy,
  versionLabel,
  endpoint,
  action,
}: DevelopersHeaderProps) {
  return (
    <header
      className="sticky top-0 z-50 border-b border-line bg-background"
      role="banner"
    >
      <div className="mx-auto flex h-8 w-full max-w-screen-2xl items-center justify-between gap-1 px-2 md:gap-2 md:px-3">
        <div className="flex min-w-0 items-center gap-1 md:gap-2">
          <OpsLockup
            orientation="horizontal"
            className="h-3 w-auto shrink-0 text-text"
          />
          <span
            aria-hidden
            className="hidden h-3 border-l border-line sm:block"
          />
          <span className="hidden font-cakemono text-cake-button uppercase text-text sm:inline">
            {copy.developers}
          </span>
          <nav
            aria-label={copy.navigationLabel}
            className="flex items-center rounded border border-line bg-surface-input p-0.5"
          >
            {REFERENCES.map((reference) => {
              const active = reference.id === activeReference;
              return (
                <a
                  key={reference.id}
                  href={reference.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "rounded-chip border border-line-hi bg-surface-active px-1 py-0.5 font-mono text-micro uppercase tracking-wider text-text"
                      : "rounded-chip border border-transparent px-1 py-0.5 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                  }
                >
                  {copy[reference.copyKey]}
                </a>
              );
            })}
          </nav>
          <span className="hidden rounded-chip border border-line bg-surface-input px-1 py-0.5 font-mono text-micro uppercase tracking-wider text-text-2 lg:inline-flex">
            {versionLabel}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden min-w-0 items-center gap-1 xl:flex">
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {copy.endpoint}
            </span>
            <code className="truncate font-mono text-data-sm text-text-2">
              {endpoint}
            </code>
          </div>
          {action ? (
            <a
              href={action.href}
              download={action.download}
              aria-label={action.label}
              className="inline-flex min-h-control-36 items-center gap-1 rounded border border-ops-accent px-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
            >
              <Download aria-hidden className="h-icon-16 w-icon-16" />
              <span className="hidden sm:inline">{action.label}</span>
              <span className="sm:hidden">{action.shortLabel}</span>
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
}
