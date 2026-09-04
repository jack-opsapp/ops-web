import type { McpDocsCopy } from "@/lib/agent-control-plane/mcp/docs/copy";

interface McpGuideNavigationProps {
  readonly copy: McpDocsCopy;
  readonly mobile?: boolean;
}

const GUIDE_LINKS = [
  ["overview", "overviewNav"],
  ["connect", "connectNav"],
  ["tested-prompts", "examplesNav"],
  ["available-tools", "capabilitiesNav"],
  ["permission-scopes", "permissionsNav"],
  ["security", "securityNav"],
  ["limits", "limitsNav"],
  ["request-tool", "requestToolNav"],
] as const;

function NavigationContents({ copy }: Pick<McpGuideNavigationProps, "copy">) {
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
    </ul>
  );
}

export function McpGuideNavigation({
  copy,
  mobile = false,
}: McpGuideNavigationProps) {
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
          <NavigationContents copy={copy} />
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
      <NavigationContents copy={copy} />
    </nav>
  );
}
