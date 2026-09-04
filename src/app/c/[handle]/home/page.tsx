import type { Metadata } from "next";
import { HomePlaceholder } from "@/components/customer/home-placeholder";
import { resolveHostedCompany } from "@/lib/customer-identity/hosted-company";
import { getCustomerCopy, resolveCustomerLocale } from "@/lib/customer-identity/hosted-copy";

interface HostedParams {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: HostedParams): Promise<Metadata> {
  const { handle } = await params;
  const [company, locale] = await Promise.all([
    resolveHostedCompany(handle),
    resolveCustomerLocale(),
  ]);
  const copy = getCustomerCopy(locale);
  return {
    title: { absolute: company ? `${company.name} · ${copy["meta.home"]}` : "OPS" },
  };
}

export default function HostedHomePage() {
  return <HomePlaceholder />;
}
