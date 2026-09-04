import type { Metadata } from "next";
import { BookingFlow } from "@/components/customer/booking/booking-flow";
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
    title: { absolute: company ? `${company.name} · ${copy["meta.book"]}` : "OPS" },
  };
}

/**
 * Guest booking. No account, no session — a homeowner picks a time, says who
 * they are, and proves one channel with a six-digit code.
 *
 * The locale is resolved here rather than read from the browser so the times
 * format identically on the server and the client, and so a visitor who set
 * `ops-lang` sees the dates in the language they chose.
 */
export default async function HostedBookPage() {
  const locale = await resolveCustomerLocale();
  return <BookingFlow locale={locale} />;
}
