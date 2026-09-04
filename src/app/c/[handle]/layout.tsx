import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/components/customer/customer-shell.css";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CustomerHostedProvider } from "@/components/customer/customer-context";
import { resolveHostedCompany } from "@/lib/customer-identity/hosted-company";
import { getCustomerCopy, resolveCustomerLocale } from "@/lib/customer-identity/hosted-copy";

/** Hosted pages are always rendered per request: company, locale and session are all request state. */
export const dynamic = "force-dynamic";

interface HostedParams {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: HostedParams): Promise<Metadata> {
  const { handle } = await params;
  const company = await resolveHostedCompany(handle);
  return {
    title: { absolute: company?.name ?? "OPS" },
    robots: { index: false, follow: false },
  };
}

export default async function HostedCustomerLayout({
  children,
  params,
}: HostedParams & { children: React.ReactNode }) {
  const { handle } = await params;
  const company = await resolveHostedCompany(handle);
  if (!company) notFound();

  const locale = await resolveCustomerLocale();
  const copy = getCustomerCopy(locale);

  return (
    <CustomerShell company={company} copy={copy}>
      <CustomerHostedProvider value={{ handle: company.handle, companyName: company.name, copy }}>
        {children}
      </CustomerHostedProvider>
    </CustomerShell>
  );
}
