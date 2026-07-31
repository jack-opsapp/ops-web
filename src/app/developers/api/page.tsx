import type { Metadata } from "next";

import en from "@/i18n/dictionaries/en/external-api-docs.json";
import { getLocale } from "@/i18n/server";
import { externalApiCodeExamples } from "@/lib/external-api/docs/code-examples";
import { getExternalApiDocsCopy } from "@/lib/external-api/docs/copy";
import { externalApiReference } from "@/lib/external-api/docs/reference";

import { ApiReferencePage } from "./_components/api-reference-page";

export const metadata: Metadata = {
  title: en.metaTitle,
  description: en.metaDescription,
  alternates: {
    canonical: "/developers/api",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    title: en.metaTitle,
    description: en.metaDescription,
  },
};

export default async function DevelopersApiPage() {
  const locale = await getLocale();
  return (
    <ApiReferencePage
      copy={getExternalApiDocsCopy(locale)}
      reference={externalApiReference}
      codeExamples={externalApiCodeExamples}
    />
  );
}
