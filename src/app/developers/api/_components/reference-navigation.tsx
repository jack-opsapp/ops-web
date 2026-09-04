import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";
import type { ExternalApiReference } from "@/lib/external-api/docs/reference";

interface ReferenceNavigationProps {
  copy: ExternalApiDocsCopy;
  reference: ExternalApiReference;
  mobile?: boolean;
}

const GUIDE_LINKS = [
  ["overview", "overviewNav"],
  ["authentication", "authenticationNav"],
  ["quick-start", "quickStartNav"],
] as const;

const OPERATIONS_BY_GROUP = {
  leadIntakeNav: [
    "getIntakeConfig",
    "createUploadBatch",
    "createIntakeSubmission",
    "getIntakeSubmission",
  ],
  leadAnalyticsNav: ["getLeadFeed", "getLeadMetrics"],
} as const;

const OPERATIONS_FOOTER_LINKS = [
  ["errors", "errorsNav"],
  ["limits", "limitsNav"],
  ["resources", "resourcesNav"],
] as const;

function NavigationContents({
  copy,
  reference,
}: Omit<ReferenceNavigationProps, "mobile">) {
  return (
    <ul className="space-y-0.5">
      {GUIDE_LINKS.map(([href, label]) => (
        <li key={href}>
          <a
            href={`#${href}`}
            className="block rounded-sidebar px-1 py-0.5 font-mohave text-body-sm text-text-3 transition-colors duration-150 ease-smooth hover:bg-surface-input hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            {copy[label]}
          </a>
        </li>
      ))}
      {Object.entries(OPERATIONS_BY_GROUP).map(([label, operationIds]) => (
        <li key={label} className="pt-2">
          <p className="px-1 pb-0.5 font-mono text-micro uppercase tracking-wider text-text-3">
            {copy[label as keyof ExternalApiDocsCopy]}
          </p>
          <ul className="space-y-0.5">
            {operationIds.map((operationId) => {
              const operation = reference.operations.find(
                (candidate) => candidate.operationId === operationId
              );
              if (!operation) return null;
              return (
                <li key={operationId}>
                  <a
                    href={`#${operationId}`}
                    className="group flex items-center gap-1 rounded-sidebar px-1 py-0.5 transition-colors duration-150 ease-smooth hover:bg-surface-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                  >
                    <span
                      className={
                        operation.method === "get"
                          ? "font-mono text-micro uppercase text-olive"
                          : "font-mono text-micro uppercase text-tan"
                      }
                    >
                      {operation.method}
                    </span>
                    <span className="truncate font-mohave text-body-sm text-text-3 group-hover:text-text-2">
                      {operation.summary}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
      {OPERATIONS_FOOTER_LINKS.map(([href, label]) => (
        <li key={href} className="first:pt-2">
          <a
            href={`#${href}`}
            className="block rounded-sidebar px-1 py-0.5 font-mohave text-body-sm text-text-3 transition-colors duration-150 ease-smooth hover:bg-surface-input hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            {copy[label]}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ReferenceNavigation({
  copy,
  reference,
  mobile = false,
}: ReferenceNavigationProps) {
  if (mobile) {
    return (
      <details className="rounded border border-line bg-surface-input p-2 xl:hidden">
        <summary className="cursor-pointer font-cakemono text-cake-button uppercase text-text">
          {copy.mobileIndexLabel}
        </summary>
        <nav
          aria-label={copy.mobileIndexLabel}
          className="mt-2 border-t border-line pt-2"
        >
          <NavigationContents copy={copy} reference={reference} />
        </nav>
      </details>
    );
  }

  return (
    <nav
      aria-label={copy.navigationLabel}
      className="sticky top-8 max-h-screen overflow-y-auto py-3 pr-2"
    >
      <p className="mb-2 px-1 font-cakemono text-cake-badge uppercase text-text">
        {copy.navigationLabel}
      </p>
      <NavigationContents copy={copy} reference={reference} />
    </nav>
  );
}
