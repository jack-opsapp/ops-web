import type { Metadata } from "next";

import { getLocale } from "@/i18n/server";
import { getMcpDocsCopy } from "@/lib/agent-control-plane/mcp/docs/copy";
import { resolvePublicMcpReference } from "@/lib/agent-control-plane/mcp/docs/reference";

import { McpGuidePage } from "./_components/mcp-guide-page";

export async function generateMetadata(): Promise<Metadata> {
  const copy = getMcpDocsCopy(await getLocale());
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: {
      canonical: "/developers/mcp",
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: "website",
      title: copy.metaTitle,
      description: copy.metaDescription,
    },
  };
}

export default async function DevelopersMcpPage() {
  const locale = await getLocale();
  return (
    <McpGuidePage
      copy={getMcpDocsCopy(locale)}
      reference={resolvePublicMcpReference(locale)}
    />
  );
}
