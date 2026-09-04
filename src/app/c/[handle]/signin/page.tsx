import type { Metadata } from "next";
import { SignInFlow } from "@/components/customer/sign-in-flow";
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
    title: { absolute: company ? `${company.name} · ${copy["meta.signIn"]}` : "OPS" },
  };
}

export default function HostedSignInPage() {
  return <SignInFlow />;
}
