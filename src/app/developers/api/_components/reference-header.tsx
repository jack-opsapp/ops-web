import { Download } from "lucide-react";

import { OpsLockup } from "@/components/brand";
import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";

interface ReferenceHeaderProps {
  copy: ExternalApiDocsCopy;
  baseUrl: string;
}

export function ReferenceHeader({ copy, baseUrl }: ReferenceHeaderProps) {
  return (
    <header
      className="sticky top-0 z-50 border-b border-line bg-background"
      role="banner"
    >
      <div className="mx-auto flex h-8 w-full max-w-screen-2xl items-center justify-between gap-2 px-2 md:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <OpsLockup
            orientation="horizontal"
            className="h-3 w-auto shrink-0 text-text"
          />
          <span aria-hidden className="h-3 border-l border-line" />
          <span className="font-cakemono text-cake-button uppercase text-text">
            {copy.headerDevelopers}
          </span>
          <span className="hidden rounded-chip border border-line bg-surface-input px-1 py-0.5 font-mono text-micro uppercase tracking-wider text-text-2 sm:inline-flex">
            {copy.headerVersion}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden min-w-0 items-center gap-1 lg:flex">
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {copy.headerBaseUrl}
            </span>
            <code className="truncate font-mono text-data-sm text-text-2">
              {baseUrl}
            </code>
          </div>
          <a
            href="/developers/api/openapi.json"
            download
            aria-label={copy.downloadOpenApi}
            className="inline-flex min-h-control-36 items-center gap-1 rounded border border-ops-accent px-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            <Download aria-hidden className="h-icon-16 w-icon-16" />
            <span className="hidden sm:inline">{copy.downloadOpenApi}</span>
            <span className="sm:hidden">OpenAPI</span>
          </a>
        </div>
      </div>
    </header>
  );
}
