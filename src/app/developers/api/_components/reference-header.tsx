import { DevelopersHeader } from "@/app/developers/_components/developers-header";
import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";

interface ReferenceHeaderProps {
  copy: ExternalApiDocsCopy;
  baseUrl: string;
}

export function ReferenceHeader({ copy, baseUrl }: ReferenceHeaderProps) {
  return (
    <DevelopersHeader
      activeReference="api"
      copy={{
        developers: copy.headerDevelopers,
        navigationLabel: copy.headerNavigationLabel,
        restApi: copy.headerRestApi,
        mcp: copy.headerMcp,
        endpoint: copy.headerBaseUrl,
      }}
      versionLabel={copy.headerVersion}
      endpoint={baseUrl}
      action={{
        href: "/developers/api/openapi.json",
        label: copy.downloadOpenApi,
        shortLabel: copy.downloadOpenApiShort,
        download: true,
      }}
    />
  );
}
